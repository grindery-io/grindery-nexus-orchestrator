import { getJwtTools } from "grindery-nexus-common-utils";

const ISSUER = "urn:grindery:orchestrator";

const jwtTools = getJwtTools(ISSUER);
jwtTools.getPublicJwk().catch((e) => {
  console.error("Failed to initialize keys:", e);
  process.exit(1);
});

const { encryptJWT, decryptJWT, signJWT, verifyJWT, getPublicJwk } = jwtTools;
export { encryptJWT, decryptJWT, signJWT, verifyJWT, getPublicJwk };
