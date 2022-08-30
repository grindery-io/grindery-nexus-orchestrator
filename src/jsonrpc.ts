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
import { createJsonRpcServer, forceObject } from "grindery-nexus-common-utils/dist/jsonrpc";

export function createServer() {
  const server = createJsonRpcServer();
  const methods = {
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
  for (const [name, func] of Object.entries(methods)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.addMethod("or_" + name, forceObject(func as any));
  }
  return server;
}
