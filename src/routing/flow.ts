import { Response } from "express";
import { AppUtils, config } from "@onflow/fcl";
import { decryptJWT, encryptJWT } from "../jwt";
import { createAsyncRouter, tokenResponse, tryRestoreSession } from "./utils";
import { AUD_LOGIN_CHALLENGE } from "./oauth";

const router = createAsyncRouter();

config({
  "accessNode.api": "https://rest-mainnet.onflow.org",
  "flow.network": "mainnet",
});
export const FLOW_APP_ID = "Grindery Nexus";
export const FLOW_AUTH_SUB = "flow::unknown";
export async function grantByFlow(
  res: Response,
  { address, nonce, signatures }: { address: string; nonce: string; signatures: unknown }
) {
  if (!address) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing address" });
  }
  if (!signatures) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing signatures" });
  }
  try {
    await decryptJWT(Buffer.from(nonce, "hex").toString(), {
      audience: AUD_LOGIN_CHALLENGE,
      subject: FLOW_AUTH_SUB,
    });
  } catch (e) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid or expired nonce" });
  }
  const isValid = await AppUtils.verifyAccountProof(FLOW_APP_ID, { address, nonce, signatures });
  if (!isValid) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid account proof" });
  }
  return await tokenResponse(res, "flow:mainnet:" + address.toLowerCase());
}

router.get("/session", async (req, res) => {
  const address = String(req.query.address || "");
  if (address && !/^0x[0-9a-f]+$/i.test(address)) {
    return res.status(400).json({ error: "invalid_flow_address" });
  }
  const subject = "flow:mainnet:" + address;
  if (await tryRestoreSession(req, res, subject)) {
    return;
  }
  const token = await encryptJWT({ aud: AUD_LOGIN_CHALLENGE, sub: FLOW_AUTH_SUB }, "300s");
  return res.json({
    app_identifier: FLOW_APP_ID,
    nonce: Buffer.from(token).toString("hex"),
    expires_in: 300,
  });
});

export const Router = router;
