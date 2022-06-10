import { createJSONRPCErrorResponse, JSONRPCErrorCode, JSONRPCParams, JSONRPCServer } from "json-rpc-2.0";
import { createWorkflow, deleteWorkflow, listWorkflows, testAction } from "./orchestrator";
import * as Sentry from "@sentry/node";

export class InvalidParamsError extends Error {
  constructor(message?: string) {
    super(message || "Invalid parameters");
  }
}
const exceptionMiddleware = async (next, request, serverParams) => {
  try {
    return await next(request, serverParams);
  } catch (error) {
    if (error instanceof InvalidParamsError) {
      return createJSONRPCErrorResponse(request.id, JSONRPCErrorCode.InvalidParams, error.message);
    } else if (error.isAxiosError) {
      return createJSONRPCErrorResponse(request.id, error.response?.status, error.message, {
        headers: error.response?.headers,
        data: error.response?.data,
      });
    } else {
      Sentry.captureException(error);
      await Sentry.flush(2000);
      throw error;
    }
  }
};
function byObject(func) {
  return async function (params: Partial<JSONRPCParams> | undefined) {
    if (typeof params !== "object" || Array.isArray(params)) {
      throw new InvalidParamsError("Only parameter object are supported");
    }
    return func(params);
  };
}
export function createJsonRpcServer() {
  const server = new JSONRPCServer();
  server.applyMiddleware(exceptionMiddleware);
  server.addMethod("or_createWorkflow", byObject(createWorkflow));
  server.addMethod("or_deleteWorkflow", byObject(deleteWorkflow));
  server.addMethod("or_listWorkflows", byObject(listWorkflows));
  server.addMethod("or_testAction", byObject(testAction));
  return server;
}
