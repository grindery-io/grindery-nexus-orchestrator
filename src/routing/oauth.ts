import { Request, Response } from "express";
import * as jose from "jose";
import * as ethLib from "eth-lib";
import base64url from "base64url";
import { decryptJWT, signJWT, encryptJWT, getPublicJwk } from "../jwt";
import { createAsyncRouter, tryRestoreSession } from "./utils";
import { tokenResponse, REFRESH_TOKEN_COOKIE } from "./utils";
import { Router as FlowRouter, grantByFlow } from "./flow";

const router = createAsyncRouter();

export const AUD_REFRESH_TOKEN = "urn:grindery:refresh-token:v1";
export const AUD_ACCESS_TOKEN = "urn:grindery:access-token:v1";
export const AUD_LOGIN_CHALLENGE = "urn:grindery:login-challenge";

const grantByEthSignature = async (res: Response, message: string, signature: string) => {
  if (!message) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing message" });
  }
  if (!signature) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing signature" });
  }
  if (!/^(0x)?[0-9a-f]+$/i.test(signature)) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid signature" });
  }
  const m = /: *(.+)$/.exec(message);
  if (!m) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid message" });
  }
  let decryptResult: jose.JWTDecryptResult;
  try {
    decryptResult = await decryptJWT(m[1], {
      audience: AUD_LOGIN_CHALLENGE,
    });
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
    const recoveredAddress = ethLib.Account.recover(messageHash, signature);
    if ("eip155:1:" + recoveredAddress.toLowerCase() !== decryptResult.payload.sub?.toLowerCase()) {
      return res
        .status(400)
        .json({ error: "invalid_request", error_description: "Signature is not from correct wallet" });
    }
  } catch (e) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid signature" });
  }
  const subject = decryptResult.payload.sub;
  return await tokenResponse(res, subject);
};

const GRANT_MODES = {
  "urn:grindery:eth-signature": async (req: Request, res: Response) => {
    const message = req.body?.message || "";
    const signature = req.body?.signature || "";
    return await grantByEthSignature(res, message, signature);
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
    const message = decodedParams?.message || "";
    const signature = decodedParams?.signature || "";
    return await grantByEthSignature(res, message, signature);
  },
  refresh_token: async (req: Request, res: Response) => {
    const token = req.body?.refresh_token;
    if (!token) {
      return res.status(400).json({ error: "invalid_request" });
    }
    try {
      const result = await decryptJWT(token, {
        audience: AUD_REFRESH_TOKEN,
      });
      return res.json({
        access_token: await signJWT({ aud: AUD_ACCESS_TOKEN, sub: result.payload.sub }, "3600s"),
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
  const url = new URL("https://nexus.grindery.org/sign-in");
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
  const token = await encryptJWT({ aud: AUD_LOGIN_CHALLENGE, sub: "eip155:1:" + address }, "300s");
  return res.json({
    message: `Signing in on Grindery: ${token}`,
    expires_in: 300,
  });
});
router.get("/session", async (req, res) => {
  const address = String(req.query.address || "");
  if (!/^0x[0-9a-f]{40}$/i.test(address)) {
    return res.status(400).json({ error: "invalid_eth_address" });
  }
  const subject = "eip155:1:" + address;
  if (await tryRestoreSession(req, res, subject)) {
    return;
  }
  const token = await encryptJWT({ aud: AUD_LOGIN_CHALLENGE, sub: subject }, "300s");
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
