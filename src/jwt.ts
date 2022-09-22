import { getJwtTools, TypedJWTPayload } from "grindery-nexus-common-utils";

const ISSUER = "urn:grindery:orchestrator";

const jwtTools = getJwtTools(ISSUER);
jwtTools.getPublicJwk().catch((e) => {
  console.error("Failed to initialize keys:", e);
  process.exit(1);
});

const { encryptJWT, decryptJWT, signJWT, verifyJWT, getPublicJwk } = jwtTools;
export { encryptJWT, decryptJWT, signJWT, verifyJWT, getPublicJwk };

type AccessTokenExtra =
  | {
      _?: never;
    }
  | {
      workspace: string;
      role: "admin" | "user";
    };
export type TAccessToken = TypedJWTPayload<AccessTokenExtra>;
export const AccessToken = jwtTools.typedToken<AccessTokenExtra>("urn:grindery:access-token:v1");
export const RefreshToken = jwtTools.typedCipher("urn:grindery:refresh-token:v1");
export const LoginChallenge = jwtTools.typedCipher("urn:grindery:login-challenge");
