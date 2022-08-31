import {
  createJSONRPCErrorResponse,
  JSONRPCErrorCode,
  JSONRPCRequest,
  JSONRPCServerMiddlewareNext,
} from "json-rpc-2.0";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflowExecutions,
  getWorkflowExecutionLog,
  listWorkflows,
  testAction,
  updateWorkflow,
  isAllowedUser,
  requestEarlyAccess,
  saveWalletAddress,
} from "./orchestrator";
import { createJsonRpcServer, forceObject, ServerParams } from "grindery-nexus-common-utils/dist/jsonrpc";
import { verifyJWT } from "./jwt";
import { AUD_ACCESS_TOKEN } from "./routing/oauth";
import assert from "assert";
import { JWTPayload } from "jose";

export type Context = {
  user?: JWTPayload;
};

export const authMiddleware = async (
  next: JSONRPCServerMiddlewareNext<ServerParams>,
  request: JSONRPCRequest,
  serverParams: ServerParams<Context> | undefined
) => {
  let token = "";
  if (serverParams?.req) {
    const m = /Bearer +(.+$)/i.exec(serverParams.req.get("Authorization") || "");
    if (m) {
      token = m[1];
    }
  } else if (["authenticate", "or_authenticate"].includes(request.method)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    token = (request.params as any)?.token || "";
  }
  if (token) {
    assert(serverParams?.context);
    try {
      serverParams.context.user = (await verifyJWT(token, { audience: AUD_ACCESS_TOKEN })).payload;
    } catch (e) {
      return createJSONRPCErrorResponse(request.id || "", JSONRPCErrorCode.InvalidParams, "Invalid access token");
    }
  }
  if (!serverParams?.context?.user) {
    return createJSONRPCErrorResponse(request.id || "", 1, "Not authorized");
  }
  return await next(request, serverParams);
};

async function authenticate() {
  // Authenticated in middleware
  return true;
}

export function createServer() {
  const server = createJsonRpcServer<Context>();
  // server.applyMiddleware(authMiddleware);
  const methods = {
    authenticate,
    createWorkflow,
    deleteWorkflow,
    updateWorkflow,
    getWorkflowExecutions,
    getWorkflowExecutionLog,
    listWorkflows,
    testAction,
    isAllowedUser,
    requestEarlyAccess,
    saveWalletAddress,
  };
  for (const [name, func] of Object.entries(methods) as [
    string,
    (params: unknown, extra: ServerParams) => Promise<unknown>
  ][]) {
    server.addMethod("or_" + name, forceObject(func));
    server.addMethod(name, forceObject(func));
  }
  return server;
}
