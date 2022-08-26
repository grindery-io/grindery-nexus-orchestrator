import { Request, Response } from "express";
import { AsyncRouter } from "express-async-router";
import * as jose from "jose";
import * as ethLib from "eth-lib";
import { decryptJWT, signJWT, encryptJWT } from "../jwt";

const router = AsyncRouter();

const AUD_REFRESH_TOKEN = "urn:grindery:refresh-token:v1";
const AUD_ACCESS_TOKEN = "urn:grindery:access-token:v1";
const AUD_LOGIN_CHALLENGE = "urn:grindery:login-challenge";

const GRANT_MODES = {
  "urn:grindery:eth-signature": async (req: Request, res: Response) => {
    const message = req.body?.message;
    let signature = req.body?.signature;

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
      if ("eip155:1:" + recoveredAddress.toLowerCase() !== decryptResult.payload.sub) {
        return res
          .status(400)
          .json({ error: "invalid_request", error_description: "Signature is not from correct wallet" });
      }
    } catch (e) {
      return res.status(400).json({ error: "invalid_request", error_description: "Invalid signature" });
    }
    return res.json({
      access_token: await signJWT({ aud: AUD_ACCESS_TOKEN, sub: decryptResult.payload.sub }, "3600s"),
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: await encryptJWT({ aud: AUD_REFRESH_TOKEN, sub: decryptResult.payload.sub }, "1000y"),
    });
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
        refresh_token: token,
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

export default router;
