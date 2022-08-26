import { createHash, createPrivateKey, createPublicKey, KeyObject, webcrypto } from "node:crypto";
import KeyEncoder from "@tradle/key-encoder";
import * as jose from "jose";

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
  process.exit(1);
});
const ISSUER = "urn:grindery:orchestrator";
export const encryptJWT = async (payload: jose.JWTPayload, expirationTime: number | string) =>
  await new jose.EncryptJWT(payload)
    .setProtectedHeader({
      alg: "dir",
      enc: "A256GCM",
    })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(expirationTime)
    .encrypt((await KEYS).AES);
export const signJWT = async (payload: jose.JWTPayload, expirationTime: number | string) =>
  await new jose.SignJWT(payload)
    .setProtectedHeader({
      alg: "ES256",
    })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(expirationTime)
    .sign((await KEYS).ECDSA_PRIVATE);
export const decryptJWT = async (token: string, options: jose.JWTDecryptOptions) =>
  await jose.jwtDecrypt(token, (await KEYS).AES, {
    issuer: ISSUER,
    keyManagementAlgorithms: ["dir"],
    contentEncryptionAlgorithms: ["A256GCM"],
    ...options,
  });
export const verifyJWT = async (token: string, options: jose.JWTVerifyOptions) =>
  await jose.jwtVerify(token, (await KEYS).ECDSA_PUBLIC, {
    issuer: ISSUER,
    algorithms: ["ES256"],
    ...options,
  });
