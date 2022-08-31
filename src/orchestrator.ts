import { v4 as uuidv4 } from "uuid";
import * as Sentry from "@sentry/node";
import { Client as HubSpotClient } from "@hubspot/api-client";

import { getCollection } from "./db";
import { OperationSchema, WorkflowSchema } from "grindery-nexus-common-utils/dist/types";
import { runSingleAction, RuntimeWorkflow } from "./runtimeWorkflow";
import axios from "axios";
import { identify, track } from "./tracking";
import { getWorkflowEnvironment } from "./utils";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { Context } from "./jsonrpc";

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
    const runtimeWorkflow = new RuntimeWorkflow(
      workflow.key,
      JSON.parse(workflow.workflow),
      workflow.userAccountId,
      getWorkflowEnvironment(workflow.key)
    );
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
function loadWorkflow(key: string, workflow: WorkflowSchema, accountId: string) {
  stopWorkflow(key);
  const runtimeWorkflow = new RuntimeWorkflow(key, workflow, accountId, getWorkflowEnvironment(key));
  allWorkflows.set(key, runtimeWorkflow);
  runtimeWorkflow.start().catch((e) => {
    console.error(e);
    Sentry.captureException(e);
  });
}

export async function createWorkflow(
  { workflow }: { workflow: WorkflowSchema },
  { context: { user } }: { context: Context }
) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  const collection = await getCollection("workflows");
  let key = uuidv4();
  if (workflow.source?.startsWith("urn:grindery-staging:")) {
    key = "staging-" + key;
  }
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
    loadWorkflow(key, workflow, userAccountId);
  }
  track(userAccountId, "Create Workflow", { workflow: key, source: workflow.source || "unknown" });
  return { key };
}

export async function updateWorkflow(
  {
    key,
    workflow,
  }: {
    key: string;
    workflow: WorkflowSchema;
  },
  { context: { user } }: { context: Context }
) {
  const userAccountId = user?.sub || "";
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
    loadWorkflow(key, workflow, userAccountId);
  } else {
    stopWorkflow(key);
  }
  track(userAccountId, "Update Workflow", { workflow: key, source: workflow.source || "unknown" });
  return { key };
}

export async function listWorkflows(_, { context: { user } }: { context: Context }) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  const collection = await getCollection("workflows");
  const result = collection.find({
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

export async function deleteWorkflow({ key }: { key: string }, { context: { user } }: { context: Context }) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  const collection = await getCollection("workflows");
  const result = await collection.deleteOne({
    userAccountId,
    key,
  });
  stopWorkflow(key);
  track(userAccountId, "Delete Workflow", { workflow: key });
  return { deleted: result.deletedCount === 1 };
}

export async function testAction(
  {
    step,
    input,
    environment,
  }: {
    step: OperationSchema;
    input: unknown;
    environment: string;
  },
  { context: { user } }: { context: Context }
) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  track(userAccountId, "Test Action", { connector: step.connector, action: step.operation, environment });
  return await runSingleAction({ step, input, dryRun: true, environment: environment || "production" });
}

export async function isAllowedUser(_, { context: { user } }: { context: Context }) {
  const userAccountId = user?.sub || "";
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

export async function requestEarlyAccess({ email }: { email: string }, { context: { user } }: { context: Context }) {
  const userAccountId = user?.sub || "";
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
  identify(userAccountId, { email });
  track(userAccountId, "Request Early Access", { email });
  return true;
}

export async function saveWalletAddress(
  {
    email,
    walletAddress,
  }: {
    email?: string;
    walletAddress: string;
  },
  { context: { user } }: { context: Context }
) {
  const userAccountId = user?.sub || "";
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
    identify(userAccountId, { email });
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
