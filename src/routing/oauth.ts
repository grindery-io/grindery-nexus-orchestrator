import { Request, Response } from "express";
import * as jose from "jose";
import * as ethLib from "eth-lib";
import base64url from "base64url";
import { getPublicJwk, RefreshToken, LoginChallenge, LoginCodeToken, TAccessToken } from "../jwt";
import { auth, createAccessTokenFromRefreshToken, createAsyncRouter, tryRestoreSession } from "./utils";
import { tokenResponse, REFRESH_TOKEN_COOKIE } from "./utils";
import { Router as FlowRouter, grantByFlow } from "./flow";
import { validateEip1271Signature } from "./eip1271";

const router = createAsyncRouter();

const grantByEthSignatureCore = async (
  res: Response,
  { message, signature, extra }: { message: string; signature: string; extra?: unknown },
  recoverAddress: (p: {
    messageHash: string;
    signature: string;
    token: jose.JWTPayload;
    extra?: unknown;
  }) => Promise<string>
) => {
  if (!message) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing message" });
  }
  if (!signature) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing signature" });
  }
  if (!/^(0x)?[0-9a-f]*$/i.test(signature)) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid signature" });
  }
  const m = /: *(.+)$/.exec(message);
  if (!m) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid message" });
  }
  let decryptResult: jose.JWTPayload;
  try {
    decryptResult = await LoginChallenge.decrypt(m[1]);
  } catch (e) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid or expired message" });
  }
  if (!/^0x/i.test(signature)) {
    signature = "0x" + signature;
  }
  const messageBuffer = Buffer.from(message);
  const preamble = Buffer.from("\x19Ethereum Signed Message:\n" + messageBuffer.length);
  const messageHash = ethLib.Hash.keccak256(Buffer.concat([preamble, messageBuffer]));
  try {
    const recoveredAddress = await recoverAddress({ messageHash, signature, token: decryptResult, extra });
    if (recoveredAddress.toLowerCase() !== decryptResult.sub?.toLowerCase()) {
      return res
        .status(400)
        .json({ error: "invalid_request", error_description: "Signature is not from correct wallet" });
    }
  } catch (e) {
    console.warn("grantByEthSignatureCore:", e);
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid signature" });
  }
  const subject = decryptResult.sub;
  return await tokenResponse(res, subject);
};

const grantByEthSignature = async (res: Response, params: Parameters<typeof grantByEthSignatureCore>[1]) => {
  return await grantByEthSignatureCore(
    res,
    params,
    async ({ messageHash, signature }) => "eip155:1:" + ethLib.Account.recover(messageHash, signature)
  );
};

const grantByEip1271Signature = async (res: Response, params: Parameters<typeof grantByEthSignatureCore>[1]) => {
  return await grantByEthSignatureCore(res, params, async ({ messageHash, signature, token }) => {
    const m = /^eip155:(\d+):(0x[0-9a-f]{40})$/i.exec(token.sub || "");
    if (!m) {
      throw new Error("Unexpected subject");
    }
    if (
      !(await validateEip1271Signature({ messageHash, signature, chainId: m[1], signer: m[2], environment: "staging" }))
    ) {
      throw new Error("Invalid signature");
    }
    return token.sub || "";
  });
};

async function grantByLoginCodeToken(res: Response, token: string) {
  if (!token) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing token" });
  }
  try {
    const result = await LoginCodeToken.decrypt(token);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return await tokenResponse(res, result.sub!, result);
  } catch (e) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid or expired token" });
  }
}

const GRANT_MODES = {
  "urn:grindery:eth-signature": async (req: Request, res: Response) => {
    const message = req.body?.message || "";
    const signature = req.body?.signature || "";
    return await grantByEthSignature(res, { message, signature });
  },
  authorization_code: async (req: Request, res: Response) => {
    let decodedParams;
    try {
      decodedParams = JSON.parse(base64url.decode(String(req.body?.code || req.query?.code || "")));
    } catch (e) {
      return res.status(400).json({ error: "invalid_request", error_description: "Invalid code" });
    }
    if (decodedParams.type === "flow") {
      return await grantByFlow(res, decodedParams);
    }
    if (decodedParams.type === "loginCodeToken") {
      return await grantByLoginCodeToken(res, decodedParams.token);
    }
    if (decodedParams.type === "eip1271") {
      return await grantByEip1271Signature(res, decodedParams);
    }
    return await grantByEthSignature(res, decodedParams);
  },
  refresh_token: async (req: Request, res: Response) => {
    const token = req.body?.refresh_token;
    if (!token) {
      return res.status(400).json({ error: "invalid_request" });
    }
    try {
      const result = await RefreshToken.decrypt(token);
      return res.json({
        access_token: await createAccessTokenFromRefreshToken(result),
        token_type: "bearer",
        expires_in: 3600,
      });
    } catch (e) {
      return res.status(400).json({ error: "invalid_request", error_description: "Invalid or expired refresh token" });
    }
  },
};

router.post("/token", async (req, res) => {
  const grantType = req.body?.grant_type;
  if (!grantType) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing grant_type" });
  }
  if (!GRANT_MODES[grantType]) {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }
  return await GRANT_MODES[grantType](req, res);
});
router.get("/authorize", async (req, res) => {
  if (req.query?.response_type !== "code") {
    const uri = String(req.query.redirect_uri || "");
    if (uri) {
      return res.redirect(`${uri}${uri.includes("?") ? "&" : "?"}error=invalid_request`);
    } else {
      return res.status(400).json({ error: "invalid_request" });
    }
  }
  const url = new URL(`https://${process.env.AUTH_FRONTEND_DOMAIN || "flow.grindery.org"}/sign-in`);
  for (const key of Object.keys(req.query)) {
    url.searchParams.set(key, String(req.query[key]));
  }
  return res.redirect(url.toString());
});
router.get("/eth-get-message", async (req, res) => {
  const address = String(req.query.address || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/i.test(address)) {
    return res.status(400).json({ error: "invalid_eth_address" });
  }
  const token = await LoginChallenge.encrypt({ sub: "eip155:1:" + address }, "300s");
  return res.json({
    message: `Signing in on Grindery: ${token}`,
    expires_in: 300,
  });
});
router.post("/get-login-code", auth, async (req, res) => {
  const user = req["user"] as TAccessToken;
  if (!user) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid token" });
  }
  if ("workspace" in user && user.workspaceRestricted) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Workspace-restricted token can't be used to exchange login code",
    });
  }
  return res.json({
    code: base64url.encode(
      JSON.stringify({
        type: "loginCodeToken",
        token: await LoginCodeToken.encrypt(
          { sub: user.sub, ...("workspace" in user ? { workspace: user.workspace, role: user.role } : {}) },
          "60s"
        ),
      })
    ),
  });
});
router.get("/session", async (req, res) => {
  const address = String(req.query.address || "");
  const chain = String(req.query.chain || "1");
  if (!/^0x[0-9a-f]{40}$/i.test(address)) {
    return res.status(400).json({ error: "invalid_eth_address" });
  }
  if (!/^\d+$/i.test(chain)) {
    return res.status(400).json({ error: "invalid_eth_chain" });
  }
  const subject = `eip155:${chain}:${address}`;
  if (await tryRestoreSession(req, res, subject)) {
    return;
  }
  const token = await LoginChallenge.encrypt({ sub: subject }, "300s");
  return res.json({
    message: `Signing in on Grindery: ${token}`,
    expires_in: 300,
  });
});
router.post("/session-register", async (req, res) => {
  if (!req.body?.refresh_token) {
    res.clearCookie(REFRESH_TOKEN_COOKIE, {
      httpOnly: true,
      sameSite: "none",
      secure: true,
    });
  } else {
    res.cookie(REFRESH_TOKEN_COOKIE, req.body.refresh_token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365,
      sameSite: "none",
      secure: true,
    });
  }
  return res.json({ success: true });
});
router.get("/jwks", async (_, res) => {
  return res.json({
    keys: [await getPublicJwk()],
  });
});

router.use("/flow", FlowRouter);
export default router;
