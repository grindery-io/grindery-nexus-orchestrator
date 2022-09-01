import axios from "axios";
import { AsyncRouter } from "express-async-router";
import { v4 as uuidv4 } from "uuid";
import { getConnectorSchema } from "../connector";
import { ConnectorSchema } from "grindery-nexus-common-utils/dist/types";
import { ConnectorInput, JsonRpcWebSocket } from "grindery-nexus-common-utils/dist/ws";
import OAuthRouter, { AUD_ACCESS_TOKEN } from "./oauth";
import { NextFunction, Request, Response } from "express";
import { JWTPayload } from "jose";
import { verifyJWT } from "../jwt";

const router = AsyncRouter();

async function auth(req: Request & { user?: JWTPayload }, res: Response, next: NextFunction) {
  const m = /Bearer +(.+$)/i.exec(req.get("Authorization") || "");
  if (m) {
    try {
      req.user = (await verifyJWT(m[1], { audience: AUD_ACCESS_TOKEN })).payload;
    } catch (e) {
      return res.status(403).json({ error: "Invalid access token" });
    }
  }
  if (!req.user) {
    return res.status(403).json({ error: "Authentication required" });
  }
  return next();
}

router.post("/input-provider/:connector/:key", auth, async (req, res) => {
  if (typeof req.body !== "object") {
    return res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: null });
  }
  const schema: ConnectorSchema | null = await getConnectorSchema(
    req.params.connector,
    String(req.query?._grinderyEnvironment || "production")
  ).catch(() => null);
  if (!schema) {
    return res
      .status(404)
      .json({ jsonrpc: "2.0", error: { code: 1, message: "Connector not found" }, id: req.body.id });
  }
  const triggerOrAction =
    schema.actions?.find((t) => t.key === req.params.key) || schema.triggers?.find((t) => t.key === req.params.key);
  if (!triggerOrAction) {
    return res
      .status(404)
      .json({ jsonrpc: "2.0", error: { code: 1, message: "Trigger or action not found" }, id: req.body.id });
  }
  const url = triggerOrAction.operation.inputFieldProviderUrl;
  if (!url) {
    return res
      .status(404)
      .json({ jsonrpc: "2.0", error: { code: 1, message: "Input provider not found" }, id: req.body.id });
  }
  try {
    const resp = await axios.post(url, req.body);
    return res.status(resp.status).json(resp.data);
  } catch (e) {
    if (e.response) {
      return res.status(e.response.status).json(e.response.data);
    }
    console.error("Unexpected error", e);
    return res.status(500).json({ jsonrpc: "2.0", error: { code: 1, message: "Unexpected error" }, id: req.body.id });
  }
});

router.all("/webhook/:connector/:key/:path?", async (req, res) => {
  if (typeof req.body !== "object") {
    return res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: null });
  }
  const schema: ConnectorSchema | null = await getConnectorSchema(
    req.params.connector,
    String(req.query?._grinderyEnvironment || "production")
  ).catch(() => null);
  if (!schema) {
    return res
      .status(404)
      .json({ jsonrpc: "2.0", error: { code: 1, message: "Connector not found" }, id: req.body.id });
  }
  const trigger = schema.triggers?.find((t) => t.key === req.params.key);
  if (!trigger) {
    return res.status(404).json({ jsonrpc: "2.0", error: { code: 1, message: "Trigger not found" }, id: req.body.id });
  }
  let url = "";
  if (trigger.operation.type === "polling") {
    url = trigger.operation.operation.url;
  }
  if (!url || !/^wss?:\/\//i.test(url)) {
    return res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32600, message: "This trigger doesn't support webhook" },
      id: req.body.id,
    });
  }
  const socket = new JsonRpcWebSocket(url);
  try {
    const resp = await socket.request<ConnectorInput>("callWebhook", {
      key: req.params.key,
      sessionId: uuidv4(),
      credentials: {},
      fields: {
        method: req.method.toUpperCase(),
        path: req.params.path,
        payload: req.body,
      },
    });
    return res.json({
      jsonrpc: "2.0",
      result: resp,
      id: req.body.id,
    });
  } catch (e) {
    console.error(`Error calling webhook ${url}`, e);
    return res.status(500).json({
      jsonrpc: "2.0",
      error: { code: 1, message: e.message || "Unexpected error" },
      id: req.body.id,
    });
  } finally {
    socket.close();
  }
});

router.use("/oauth", OAuthRouter);

export default router;