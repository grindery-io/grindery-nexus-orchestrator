import axios from "axios";
import { AsyncRouter } from "express-async-router";
import { v4 as uuidv4 } from "uuid";
import { getConnectorSchema } from "./connector";
import { ConnectorSchema } from "./types";
import { ConnectorInput, JsonRpcWebSocket } from "./ws";

const router = AsyncRouter();

router.post("/input-provider/:connector/:key", async (req, res) => {
  if (typeof req.body !== "object") {
    return res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: null });
  }
  const schema: ConnectorSchema | null = await getConnectorSchema(req.params.connector).catch(() => null);
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

router.post("/webhook/:connector/:key", async (req, res) => {
  if (typeof req.body !== "object") {
    return res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: null });
  }
  const schema: ConnectorSchema | null = await getConnectorSchema(req.params.connector).catch(() => null);
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
        payload: req.body,
      },
    });
    return res.json({
      jsonrpc: "2.0",
      result: resp,
      id: req.body.id,
    });
  } catch (e) {
    return res.status(500).json({
      jsonrpc: "2.0",
      error: { code: 1, message: e.message || "Unexpected error" },
      id: req.body.id,
    });
  } finally {
    socket.close();
  }
});

export default router;