import { v4 as uuidv4 } from "uuid";
import * as Sentry from "@sentry/node";
import { Client as HubSpotClient } from "@hubspot/api-client";

import { InvalidParamsError } from "./jsonrpc";
import { getCollection } from "./db";
import { OperationSchema, WorkflowSchema } from "./types";
import { runSingleAction, RuntimeWorkflow } from "./runtimeWorkflow";
import axios from "axios";

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
if (process.env.NODE_ENV === "production") {
  setTimeout(loadAllWorkflows, 1000);
} else {
  console.log("In development mode, will not load workflows");
}
function stopWorkflow(key: string) {
  if (allWorkflows.has(key)) {
    const existing = allWorkflows.get(key);
    existing?.stop();
    allWorkflows.delete(key);
  }
}
function loadWorkflow(key: string, workflow: WorkflowSchema) {
  stopWorkflow(key);
  const runtimeWorkflow = new RuntimeWorkflow(key, workflow);
  allWorkflows.set(key, runtimeWorkflow);
  runtimeWorkflow.start().catch((e) => {
    console.error(e);
    Sentry.captureException(e);
  });
}

export async function createWorkflow({ userAccountId, workflow }: { userAccountId: string; workflow: WorkflowSchema }) {
  verifyAccountId(userAccountId);
  const collection = await getCollection("workflows");
  const key = uuidv4();
  const enabled = workflow.state !== "off";
  await collection.insertOne({
    key,
    userAccountId,
    workflow: JSON.stringify(workflow),
    enabled,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (enabled) {
    loadWorkflow(key, workflow);
  }
  return { key };
}

export async function updateWorkflow({
  userAccountId,
  key,
  workflow,
}: {
  userAccountId: string;
  key: string;
  workflow: WorkflowSchema;
}) {
  verifyAccountId(userAccountId);
  if (!key) {
    throw new InvalidParamsError("Missing key");
  }
  const collection = await getCollection("workflows");
  const enabled = workflow.state !== "off";
  const result = await collection.updateOne(
    { key, userAccountId },
    { $set: { workflow: JSON.stringify(workflow), enabled, updatedAt: Date.now() } }
  );
  if (result.matchedCount === 0) {
    throw new Error(`Workflow not found: ${key}`);
  }
  if (enabled) {
    loadWorkflow(key, workflow);
  } else {
    stopWorkflow(key);
  }
  return { key };
}

export async function listWorkflows({ userAccountId }: { userAccountId: string }) {
  verifyAccountId(userAccountId);
  const collection = await getCollection("workflows");
  const result = await collection.find({
    userAccountId,
  });
  return (await result.toArray()).map((x) => ({
    ...x,
    workflow: JSON.parse(x.workflow),
    state: x.enabled ? "on" : "off",
  }));
}

export async function getWorkflowExecutions({
  workflowKey,
  since,
  until,
  limit,
}: {
  workflowKey: string;
  since?: number;
  until?: number;
  limit?: number;
}) {
  if (!workflowKey) {
    throw new InvalidParamsError("Missing workflowKey");
  }
  const collection = await getCollection("workflowExecutions");
  const result = await collection.aggregate([
    { $match: { workflowKey, startedAt: { $gte: since || 0, $lte: until || Infinity } } },
    {
      $group: {
        _id: "$executionId",
        startedAt: { $min: "$startedAt" },
      },
    },
    { $sort: { startedAt: -1 } },
    { $limit: limit || 100 },
  ]);
  return (await result.toArray()).map((x) => ({ executionId: x._id, startedAt: x.startedAt }));
}
export async function getWorkflowExecutionLog({ executionId }: { executionId: string }) {
  if (!executionId) {
    throw new InvalidParamsError("Missing executionId");
  }
  const collection = await getCollection("workflowExecutions");
  const result = await collection.find({
    executionId,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await result.toArray()).map((x: any) => {
    delete x._id;
    return x;
  });
}

export async function deleteWorkflow({ userAccountId, key }: { userAccountId: string; key: string }) {
  verifyAccountId(userAccountId);
  const collection = await getCollection("workflows");
  const result = await collection.deleteOne({
    userAccountId,
    key,
  });
  stopWorkflow(key);
  return { deleted: result.deletedCount === 1 };
}

export async function testAction({
  userAccountId,
  step,
  input,
}: {
  userAccountId: string;
  step: OperationSchema;
  input: unknown;
}) {
  verifyAccountId(userAccountId);
  return await runSingleAction({ step, input, dryRun: true });
}

export async function isAllowedUser({ userAccountId }: { userAccountId: string }) {
  verifyAccountId(userAccountId);
  const hubspotClient = new HubSpotClient({ accessToken: process.env.HS_PRIVATE_TOKEN });
  const resp = await hubspotClient.crm.contacts.searchApi.doSearch({
    filterGroups: [
      {
        filters: [
          {
            propertyName: "ceramic_did",
            operator: "EQ",
            value: userAccountId,
          },
          {
            propertyName: "approved_for_early_access",
            operator: "EQ",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            value: true as any,
          },
        ],
      },
    ],
    properties: ["email"],
    limit: 1,
    after: 0,
    sorts: [],
  });
  if (resp.results.length) {
    return true;
  }
  return (process.env.ALLOWED_USERS || "").split(",").includes(userAccountId);
}

export async function requestEarlyAccess({ userAccountId, email }: { userAccountId: string; email: string }) {
  verifyAccountId(userAccountId);
  if (!email) {
    throw new InvalidParamsError("Missing email");
  }
  if (!/^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(email)) {
    throw new InvalidParamsError("Invalid email");
  }
  await axios.post(
    `https://api.hsforms.com/submissions/v3/integration/submit/${process.env.HS_PORTAL_ID}/${process.env.HS_EARLY_ACCESS_FORM}`,
    {
      fields: [
        { name: "email", value: email },
        { name: "ceramic_did", value: userAccountId },
      ],
    }
  );
  return true;
}

export async function saveWalletAddress({
  userAccountId,
  email,
  walletAddress,
}: {
  userAccountId: string;
  email?: string;
  walletAddress: string;
}) {
  verifyAccountId(userAccountId);
  if (!walletAddress) {
    throw new InvalidParamsError("Missing walletAddress");
  }
  if (email && !/^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(email)) {
    throw new InvalidParamsError("Invalid email");
  }
  const hubspotClient = new HubSpotClient({ accessToken: process.env.HS_PRIVATE_TOKEN });
  const resp = await hubspotClient.crm.contacts.searchApi.doSearch({
    filterGroups: [
      {
        filters: [
          {
            propertyName: "ceramic_did",
            operator: "EQ",
            value: userAccountId,
          },
        ],
      },
    ],
    properties: ["email"],
    limit: 1,
    after: 0,
    sorts: [],
  });
  const newProps: { [key: string]: string } = {
    wallet_address: walletAddress,
    ceramic_did: userAccountId,
  };
  if (email) {
    newProps.email = email;
  } else if (!resp.results[0]?.properties?.email) {
    newProps.email = `${walletAddress}@wallet.grindery.org`;
  }
  if (resp.results[0]) {
    await hubspotClient.crm.contacts.basicApi.update(resp.results[0].id, { properties: newProps });
  } else {
    await hubspotClient.crm.contacts.basicApi.create({ properties: newProps });
  }
  return true;
}
