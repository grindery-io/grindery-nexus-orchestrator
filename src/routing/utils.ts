import { Request, Response, NextFunction } from "express";
import { AsyncRouter } from "express-async-router";
import { JWTPayload } from "jose";
import { signJWT, encryptJWT, decryptJWT, verifyJWT } from "../jwt";
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
  if (!subject) {
    return false;
  }
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

export async function auth(req: Request & { user?: JWTPayload }, res: Response, next: NextFunction) {
  const m = /Bearer +(.+$)/i.exec(req.get("Authorization") || "");
  let token = "";
  if (m) {
    token = m[1];
  } else if (req.query?.access_token) {
    token = String(req.query?.access_token);
  }
  if (token) {
    try {
      req.user = (await verifyJWT(token, { audience: AUD_ACCESS_TOKEN })).payload;
    } catch (e) {
      return res.status(403).json({ error: "Invalid access token" });
    }
  }
  if (!req.user) {
    return res.status(403).json({ error: "Authentication required" });
  }
  return next();
}
