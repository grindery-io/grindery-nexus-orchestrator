import { v4 as uuidv4 } from "uuid";
import * as Sentry from "@sentry/node";

import { InvalidParamsError } from "./jsonrpc";
import { getCollection } from "./db";
import { WorkflowSchema } from "./types";
import { RuntimeWorkflow } from "./runtimeWorkflow";

function verifyAccountId(accountId: string) {
  // Reference: https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-10.md
  if (typeof accountId !== "string" || !/^[-a-z0-9]{3,8}:[-a-zA-Z0-9]{1,32}:[a-zA-Z0-9]{1,64}$/.test(accountId)) {
    throw new InvalidParamsError("Invalid CAIP-10 account ID");
  }
}
const allWorkflows = new Map<string, RuntimeWorkflow>();
async function loadAllWorkflows() {
  const workflowCollection = await getCollection("workflows");
  const workflows = await workflowCollection.find({ enabled: true });
  for (;;) {
    const workflow = await workflows.next();
    if (!workflow) {
      break;
    }
    const runtimeWorkflow = new RuntimeWorkflow(workflow.key, JSON.parse(workflow.workflow));
    allWorkflows.set(workflow.key, runtimeWorkflow);
    runtimeWorkflow.start().catch((e) => {
      console.error(e);
      Sentry.captureException(e);
    });
  }
}
setTimeout(loadAllWorkflows, 1000);
export async function createWorkflow({ userAccountId, workflow }: { userAccountId: string; workflow: WorkflowSchema }) {
  verifyAccountId(userAccountId);
  const collection = await getCollection("workflows");
  const key = uuidv4();
  await collection.insertOne({
    key,
    userAccountId,
    workflow: JSON.stringify(workflow),
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const runtimeWorkflow = new RuntimeWorkflow(key, workflow);
  allWorkflows.set(key, runtimeWorkflow);
  runtimeWorkflow.start().catch((e) => {
    console.error(e);
    Sentry.captureException(e);
  });
  return { key };
}

export async function listWorkflows({ userAccountId }: { userAccountId: string }) {
  verifyAccountId(userAccountId);
  const collection = await getCollection("workflows");
  const result = await collection.find({
    userAccountId,
  });
  return (await result.toArray()).map((x) => ({ ...x, workflow: JSON.parse(x.workflow) }));
}

export async function deleteWorkflow({ userAccountId, key }: { userAccountId: string; key: string }) {
  verifyAccountId(userAccountId);
  const collection = await getCollection("workflows");
  const result = await collection.deleteOne({
    userAccountId,
    key,
  });
  if (allWorkflows.has(key)) {
    allWorkflows.get(key)?.stop();
    allWorkflows.delete(key);
  }
  return { deleted: result.deletedCount === 1 };
}
