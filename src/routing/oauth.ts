import { createHash, createPrivateKey, createPublicKey, KeyObject, webcrypto } from "node:crypto";
import KeyEncoder from "@tradle/key-encoder";
import { Request, Response } from "express";
import { AsyncRouter } from "express-async-router";
import * as jose from "jose";

const router = AsyncRouter();

const KEYS = (async () => {
  const masterKey = Buffer.from(process.env.MASTER_KEY || "ERASED");
  process.env["MASTER_KEY"] = "ERASED";
  if (masterKey.length < 64) {
    throw new Error("Invalid master key in environment variable");
  }
  const rawKeySource = createHash("sha512").update(masterKey).digest();
  masterKey.fill(0);

  const rawKey = await webcrypto.subtle.importKey("raw", rawKeySource, "PBKDF2", false, ["deriveBits", "deriveKey"]);
  rawKeySource.fill(0);

  const AES = KeyObject.from(
    await webcrypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        iterations: 10,
        salt: createHash("sha512").update("Grindery AES Key").digest().subarray(0, 16),
        hash: "SHA-512",
      },
      rawKey,
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
    )
  );
  const keyEncoder = new KeyEncoder("p256");
  const pemKey = keyEncoder.encodePrivate(
    Buffer.from(
      await webcrypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          iterations: 10,
          salt: createHash("sha512").update("Grindery ECDSA Key").digest().subarray(0, 16),
          hash: "SHA-512",
        },
        rawKey,
        256
      )
    ),
    "raw",
    "pem",
    "pkcs8"
  );
  const ECDSA_PRIVATE = createPrivateKey({ key: pemKey, format: "pem" });
  const ECDSA_PUBLIC = createPublicKey(ECDSA_PRIVATE);
  return { AES, ECDSA_PRIVATE, ECDSA_PUBLIC };
})();
KEYS.catch((e) => {
  console.error("Failed to initialize keys:", e);
  // process.exit(1);
});

const ISSUER = "urn:grindery:orchestrator";

const GRANT_MODES = {
  "urn:grindery:eth-signature": async (_req: Request, _res: Response) => {
    throw new Error("Not implemented");
  },
};

router.post("/token", async (req, res) => {
  const grantType = req.body?.grant_type;
  if (!grantType) {
    return res.status(400).json({ error: "invalid_request" });
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
  const token = await new jose.EncryptJWT({ address })
    .setProtectedHeader({
      alg: "dir",
      enc: "A256GCM",
    })
    .setIssuedAt()
    .setExpirationTime("300s")
    .setIssuer(ISSUER)
    .setAudience("urn:grindery:login-challenge")
    .encrypt((await KEYS).AES);
  return res.json({
    message: `Signing in on Grindery: ${Buffer.from(JSON.stringify({ challenge: token })).toString("base64")}`,
  });
});

export default router;
