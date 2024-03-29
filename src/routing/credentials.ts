import { URL } from "node:url";
import assert from "assert";
import { Request } from "express";
import { AccessToken, TAccessToken, typedCipher } from "../jwt";
import { auth, createAsyncRouter } from "./utils";
import { getConnectorSchema, TypedJWTPayload } from "grindery-nexus-common-utils";
import { callCredentialManager } from "../credentialManagerClient";

const router = createAsyncRouter();

type AuthStateExtra = {
  redirectUri: string;
  state: string;
  environment: string;
  connectorId: string;
  workspace: string | undefined;
};
type TAuthState = TypedJWTPayload<AuthStateExtra>;
const AuthState = typedCipher<AuthStateExtra>("urn:grindery:auth-state");

type CallbackStateExtra = {
  code: string;
  environment: string;
  connectorId: string;
  workspace: string | undefined;
};
type TCallbackState = TypedJWTPayload<CallbackStateExtra>;
const CallbackState = typedCipher<CallbackStateExtra>("urn:grindery:callback-state");

const ALLOWED_REDIRECT_URI = [/^https?:\/\/localhost\b.*$/, /^https:\/\/[^.]+\.grindery\.(io|org|tg|com)\/.*$/];

function getRedirectUri(req: Request): string {
  return `${req.hostname.startsWith("localhost") ? "http" : "https"}://${process.env.HOST || req.get("Host")}${
    req.baseUrl
  }/auth/callback`;
}
router.get("/:environment/:connectorId/auth", auth, async (req: Request & { user?: TAccessToken }, res) => {
  assert(req.user);
  if (!req.query?.redirect_uri) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing redirect_uri" });
  }
  if (!ALLOWED_REDIRECT_URI.some((x) => x.test(String(req.query.redirect_uri)))) {
    return res.status(400).json({ error: "invalid_request", error_description: "Unauthorized redirect_uri" });
  }
  const { environment, connectorId } = req.params;
  let authorizeUrl: string;
  try {
    authorizeUrl = await callCredentialManager("getConnectorAuthorizeUrl", { connectorId, environment });
  } catch (e) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid connector ID" });
  }
  const url = new URL(authorizeUrl);
  const state = await AuthState.encrypt(
    {
      sub: req.user.sub,
      workspace: "workspace" in req.user ? req.user.workspace : undefined,
      redirectUri: String(req.query.redirect_uri),
      state: String(req.query.state),
      environment,
      connectorId,
    },
    "1h"
  );
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", getRedirectUri(req));
  return res.redirect(url.toString());
});
router.get("/auth/callback", async (req, res) => {
  if (!req.query?.state) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing state" });
  }
  let decryptedState: TAuthState;
  try {
    decryptedState = await AuthState.decrypt(String(req.query.state));
  } catch (e) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid state" });
  }
  const url = new URL(decryptedState.redirectUri as string);
  if (decryptedState.state) {
    url.searchParams.set("state", decryptedState.state as string);
  }
  if (req.query.error) {
    url.searchParams.set("error", String(req.query.error));
  } else {
    const { environment, connectorId } = decryptedState;
    const connector = await getConnectorSchema(connectorId, environment);
    if (!connector) {
      return res.status(500).json({ error: "server_error", error_description: "Connector is no longer available" });
    }
    const code = await CallbackState.encrypt(
      {
        sub: decryptedState.sub,
        environment,
        connectorId,
        code: String(
          req.query[
            (connector.authentication?.type === "oauth2" && connector.authentication.oauth2Config.codeParam) || "code"
          ]
        ),
        workspace: decryptedState.workspace,
      },
      "300s"
    );
    url.searchParams.set("code", code);
  }
  return res.redirect(url.toString());
});
const authCompleteCache = new Map<string, unknown>();
router.post("/auth/complete", auth, async (req: Request & { user?: TAccessToken }, res) => {
  assert(req.user);
  if (!req.body?.code) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing code" });
  }
  let decryptedState: TCallbackState;
  try {
    decryptedState = await CallbackState.decrypt(String(req.body?.code), { subject: req.user.sub });
    if (decryptedState.workspace !== ("workspace" in req.user ? req.user.workspace : undefined)) {
      throw new Error("Workspace doesn't match");
    }
  } catch (e) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid code" });
  }
  const { connectorId, environment, code } = decryptedState;
  const cacheKey = [connectorId, environment, code, req.user.sub].join("|");
  if (!authCompleteCache.has(cacheKey)) {
    authCompleteCache.set(
      cacheKey,
      callCredentialManager(
        "completeConnectorAuthorization",
        {
          connectorId,
          environment,
          displayName: req.body.displayName,
          params: { code, redirect_uri: getRedirectUri(req) },
        },
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await AccessToken.sign(req.user!, "60s")
      ).then((result) => {
        authCompleteCache.set(cacheKey, result);
        return result;
      })
    );
    setTimeout(() => authCompleteCache.delete(cacheKey), 1000 * 60 * 60).unref();
  }
  let result;
  try {
    result = await authCompleteCache.get(cacheKey);
  } catch (e) {
    console.error("Failed to complete authentication flow:", e);
    return res
      .status(400)
      .json({ error: "invalid_request", error_description: "Failed to complete authentication flow" });
  }
  return res.json(result);
});

router.all("/:connectorId/request/:domain*", async (req: Request & { rawBody?: Buffer | string }, res) => {
  const authHeader = req.get("Authorization");
  if (!authHeader) {
    return res.status(401).json({ error: "missing_authorization_header" });
  }
  const m = /Bearer (.*)$/.exec(authHeader);
  if (!m) {
    return res.status(401).json({ error: "invalid_authorization_header" });
  }
  const credentialToken = m[1];
  let user: TAccessToken | null = null;
  if (req.get("x-grindery-user")) {
    // User is optional, this is for debugging only
    try {
      user = await AccessToken.verify(String(req.get("x-grindery-user")));
    } catch (e) {
      // Fall below
    }
    if (!user) {
      return res.status(401).json({ error: "invalid_user_token" });
    }
  }
  const templateScope = req.get("x-grindery-template-scope") || "headers";
  if (!["all", "headers"].includes(templateScope)) {
    return res.status(400).json({ error: "invalid_template_scope" });
  }
  const pathM = /^\/+[^/]+?\/+[^/]+?\/+[^/]+?\/+(.*)$/.exec(req.path);
  const domain = req.params["domain"];
  const isLocal = domain.includes(":") && !domain.includes(".");
  const request = {
    method: req.method,
    url: `${isLocal ? "http" : "https"}://${domain}/${pathM?.[1] || ""}`,
    params: req.query,
    headers: {},
    body: undefined as undefined | string,
  };
  if (req.rawBody) {
    request.body = typeof req.rawBody === "string" ? req.rawBody : req.rawBody.toString("utf-8");
    if (req.get("content-type")) {
      request.headers["content-type"] = String(req.get("content-type"));
    }
  }
  for (const [key, value] of Object.entries(req.headers)) {
    let m = /^x-grindery-request-base64-(.+)$/.exec(key);
    if (m) {
      request.headers[m[1]] = Buffer.from(value as string, "base64").toString();
      continue;
    }
    m = /^x-grindery-request-(.+)$/.exec(key);
    if (m) {
      request.headers[m[1]] = value;
    }
  }
  const { connectorId } = req.params;
  const result = await callCredentialManager(
    "makeRequest",
    {
      connectorId,
      request,
      credentialToken,
      templateScope,
      rejectProduction: !!req.get("x-forwarded-for") && !user,
    },
    user ? await AccessToken.sign(user, "60s") : undefined
  );
  if (result.status) {
    res.status(result.status);
  }
  if (result.headers?.["content-type"]) {
    res.contentType(result.headers?.["content-type"]);
  }
  if (typeof result.data === "string") {
    res.send(result.data);
  } else {
    res.json(result.data);
  }
});

export default router;
