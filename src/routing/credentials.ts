import { URL } from "node:url";
import assert from "assert";
import axios from "axios";
import { Request } from "express";
import { JWTPayload } from "jose";
import { JSONRPCClient } from "json-rpc-2.0";
import { decryptJWT, encryptJWT, signJWT } from "../jwt";
import { auth, createAsyncRouter } from "./utils";

const router = createAsyncRouter();

const AUD_AUTH_STATE = "urn:grindery:auth-state";
const AUD_CALLBACK_STATE = "urn:grindery:callback-state";
const ALLOWED_REDIRECT_URI = [/^https?:\/\/localhost\b.*$/, /^https:\/\/[^.]+\.grindery\.(io|org)\/.*$/];

const credentialManagerClient: JSONRPCClient = new JSONRPCClient((jsonRPCRequest) =>
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  axios.post(process.env.CREDENTIAL_MANAGER_URI!, jsonRPCRequest).then(
    (response) => credentialManagerClient.receive(response.data),
    (e) => {
      if (e.response?.data?.id === jsonRPCRequest.id) {
        credentialManagerClient.receive(e.response.data);
        return;
      }
      console.error("Unexpected error from JSON-RPC request: ", e, { jsonRPCRequest });
      if (jsonRPCRequest.id) {
        credentialManagerClient.receive({
          jsonrpc: jsonRPCRequest.jsonrpc,
          id: jsonRPCRequest.id,
          error: e.toString(),
        });
      }
    }
  )
);
const callCredentialManager = (method: string, params) => credentialManagerClient.timeout(5000).request(method, params);

function getRedirectUri(req: Request): string {
  return `${req.hostname.startsWith("localhost") ? "http" : "https"}://${process.env.HOST || req.get("Host")}${
    req.baseUrl
  }/auth/callback`;
}
router.get("/:environment/:connectorId/auth", auth, async (req: Request & { user?: JWTPayload }, res) => {
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
  const state = await encryptJWT(
    {
      aud: AUD_AUTH_STATE,
      sub: req.user.sub,
      redirectUri: req.query.redirect_uri,
      state: req.query.state,
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
  let decryptedState: JWTPayload;
  try {
    decryptedState = (await decryptJWT(String(req.query.state), { audience: AUD_AUTH_STATE })).payload;
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
    const code = await encryptJWT(
      {
        aud: AUD_CALLBACK_STATE,
        sub: decryptedState.sub,
        environment: decryptedState.environment,
        connectorId: decryptedState.connectorId,
        code: req.query.code,
      },
      "300s"
    );
    url.searchParams.set("code", code);
  }
  return res.redirect(url.toString());
});
router.post("/auth/complete", auth, async (req: Request & { user?: JWTPayload }, res) => {
  assert(req.user);
  if (!req.body?.code) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing code" });
  }
  let decryptedState: JWTPayload;
  try {
    decryptedState = (await decryptJWT(String(req.body?.code), { audience: AUD_CALLBACK_STATE, subject: req.user.sub }))
      .payload;
  } catch (e) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid code" });
  }
  const { connectorId, environment, code } = decryptedState;
  let result;
  try {
    result = await callCredentialManager("completeConnectorAuthorization", {
      connectorId,
      environment,
      displayName: req.body.displayName || new Date().toISOString(),
      params: { code, redirect_uri: getRedirectUri(req) },
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      accessToken: await signJWT(req.user!, "60s"),
    });
  } catch (e) {
    return res
      .status(400)
      .json({ error: "invalid_request", error_description: "Failed to complete authentication flow" });
  }
  return res.json(result);
});

export default router;
