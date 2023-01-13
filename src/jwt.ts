import { getJwtTools, TypedJWTPayload } from "grindery-nexus-common-utils";

const ISSUER = "urn:grindery:orchestrator";

const jwtTools = getJwtTools(ISSUER);
jwtTools.getPublicJwk().catch((e) => {
  console.error("Failed to initialize keys:", e);
  process.exit(1);
});

const { encryptJWT, decryptJWT, signJWT, verifyJWT, getPublicJwk, typedCipher, typedToken } = jwtTools;
export { encryptJWT, decryptJWT, signJWT, verifyJWT, getPublicJwk, typedCipher, typedToken };

type AccessTokenExtra =
  | {
      _?: never;
    }
  | {
      workspace: string;
      role: "admin" | "user";
      workspaceRestricted?: boolean;
    };
export type TAccessToken = TypedJWTPayload<AccessTokenExtra>;
export const AccessToken = jwtTools.typedToken<AccessTokenExtra>("urn:grindery:access-token:v1");

export type RefreshTokenExtra = {
  workspace?: string;
  role?: "admin" | "user";
};
export type TRefreshToken = TypedJWTPayload<RefreshTokenExtra>;
export const RefreshToken = jwtTools.typedCipher<RefreshTokenExtra>("urn:grindery:refresh-token:v1");
export const LoginCodeToken = jwtTools.typedCipher<RefreshTokenExtra>("urn:grindery:login-code-token:v1");
export const LoginChallenge = jwtTools.typedCipher("urn:grindery:login-challenge");
