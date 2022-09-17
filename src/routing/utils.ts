import { Request, Response } from "express";
import { AsyncRouter } from "express-async-router";
import { signJWT, encryptJWT, decryptJWT } from "../jwt";
import { AUD_REFRESH_TOKEN, AUD_ACCESS_TOKEN } from "./oauth";

export function createAsyncRouter() {
  return AsyncRouter({
    sender: (req, res, value) => {
      console.warn("Returning value from async handler", { url: req.url });
      try {
        const json = JSON.stringify(value);
        return res.json(json);
      } catch (e) {
        return res.json({ message: "unknown_result" });
      }
    },
  });
}

export const REFRESH_TOKEN_COOKIE = "grinderyNexusRefreshToken";
export async function tokenResponse(res: Response, subject: string) {
  const refreshToken = await encryptJWT({ aud: AUD_REFRESH_TOKEN, sub: subject }, "1000y");
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 365,
    sameSite: "strict",
    secure: true,
  });
  return res.json({
    access_token: await signJWT({ aud: AUD_ACCESS_TOKEN, sub: subject }, "3600s"),
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: refreshToken,
  });
}

export async function tryRestoreSession(req: Request, res: Response, subject: string) {
  const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
  if (refreshToken) {
    try {
      const result = await decryptJWT(refreshToken, {
        audience: AUD_REFRESH_TOKEN,
        subject,
      });
      res.json({
        access_token: await signJWT({ aud: AUD_ACCESS_TOKEN, sub: result.payload.sub }, "3600s"),
        token_type: "bearer",
        expires_in: 3600,
      });
      return true;
    } catch (e) {
      // Ignore
    }
  }
  return false;
}