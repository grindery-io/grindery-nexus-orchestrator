import { Request, Response, NextFunction } from "express";
import { AsyncRouter } from "express-async-router";
import { AccessToken, RefreshToken, TAccessToken, RefreshTokenExtra, TRefreshToken } from "../jwt";

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

export async function createAccessTokenFromRefreshToken(token: TRefreshToken) {
  return await AccessToken.sign(
    {
      sub: token.sub,
      ...(token.workspace ? { workspace: token.workspace, workspaceRestricted: true, role: token.role || "user" } : {}),
    },
    "3600s"
  );
}

export const REFRESH_TOKEN_COOKIE = "grinderyNexusRefreshToken";
export async function tokenResponse(res: Response, subject: string, extra: RefreshTokenExtra = {}) {
  const refreshTokenData: TRefreshToken = { sub: subject, workspace: extra.workspace, role: extra.role };
  const refreshToken = await RefreshToken.encrypt(refreshTokenData, "1000y");
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 365,
    sameSite: "strict",
    secure: true,
  });
  return res.json({
    access_token: await createAccessTokenFromRefreshToken(refreshTokenData),
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
      const result = await RefreshToken.decrypt(refreshToken, {
        subject,
      });
      res.json({
        access_token: await AccessToken.sign({ sub: result.sub }, "3600s"),
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

export async function auth(req: Request & { user?: TAccessToken }, res: Response, next: NextFunction) {
  const m = /Bearer +(.+$)/i.exec(req.get("Authorization") || "");
  let token = "";
  if (m) {
    token = m[1];
  } else if (req.query?.access_token) {
    token = String(req.query?.access_token);
  }
  if (token) {
    try {
      req.user = await AccessToken.verify(token);
    } catch (e) {
      return res.status(401).json({ error: "Invalid access token" });
    }
  }
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  return next();
}
