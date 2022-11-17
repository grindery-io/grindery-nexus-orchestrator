import { v4 as uuidv4 } from "uuid";
import * as Sentry from "@sentry/node";
import { Client as HubSpotClient } from "@hubspot/api-client";

import { DbSchema, getCollection } from "../db";
import { OperationSchema, WorkflowSchema } from "grindery-nexus-common-utils/dist/types";
import { runSingleAction, RuntimeWorkflow } from "../runtimeWorkflow";
import axios from "axios";
import { identify, track } from "../tracking";
import { getWorkflowEnvironment } from "../utils";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { Context } from "../jsonrpc";
import { throwNotFoundOrPermissionError } from "./workspace";

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
      getWorkflowEnvironment(workflow.key),
      workflow.workspaceKey
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
function loadWorkflow({
  key,
  workflow,
  accountId,
  workspaceKey,
}: {
  key: string;
  workflow: WorkflowSchema;
  accountId: string;
  workspaceKey: string | undefined;
}) {
  stopWorkflow(key);
  const runtimeWorkflow = new RuntimeWorkflow(key, workflow, accountId, getWorkflowEnvironment(key), workspaceKey);
  allWorkflows.set(key, runtimeWorkflow);
  runtimeWorkflow.start().catch((e) => {
    console.error(e);
    Sentry.captureException(e);
  });
}

async function checkWorkspacePermission(workspaceKey: string, userAccountId: string) {
  const wsCollection = await getCollection("workspaces");
  const workspace = await wsCollection.findOne({
    $and: [{ key: workspaceKey }, { $or: [{ admins: { $in: [userAccountId] } }, { users: { $in: [userAccountId] } }] }],
  });
  if (!workspace) {
    await throwNotFoundOrPermissionError(workspaceKey);
  }
}

export async function createWorkflow(
  { workflow, workspaceKey }: { workflow: WorkflowSchema; workspaceKey?: string },
  { context: { user } }: { context: Context }
) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  if (workspaceKey) {
    await checkWorkspacePermission(workspaceKey, userAccountId);
  }
  const collection = await getCollection("workflows");
  let key = uuidv4();
  if (workflow.source?.startsWith("urn:grindery-staging:")) {
    key = "staging-" + key;
  }
  const enabled = workflow.state !== "off";
  await collection.insertOne({
    key,
    ...(workspaceKey ? { workspaceKey } : {}),
    userAccountId,
    workflow: JSON.stringify(workflow),
    enabled,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (enabled) {
    loadWorkflow({ key, workflow, accountId: userAccountId, workspaceKey });
  }
  track(userAccountId, "Create Workflow", {
    workflow: key,
    workspace: workspaceKey,
    role: user && "role" in user ? user.role : undefined,
    source: workflow.source || "unknown",
    title: workflow.title,
    enabled,
    triggers: workflow.trigger ? [`${workflow.trigger.connector}/${workflow.trigger.operation}`] : [],
    actions: workflow.actions.map((x) => `${x.connector}/${x.operation}`),
  });
  return { key };
}

async function fetchWorkflowAndCheckPermission(key: string, userAccountId: string) {
  const collection = await getCollection("workflows");
  const existingWorkflow = await collection.findOne({ key });
  if (!existingWorkflow) {
    throw new Error(`Workflow not found: ${key}`);
  }
  if (existingWorkflow.workspaceKey) {
    await checkWorkspacePermission(existingWorkflow.workspaceKey, userAccountId);
  } else {
    if (existingWorkflow.userAccountId !== userAccountId) {
      throw new Error("User has no permission to change the workflow");
    }
  }
  return existingWorkflow;
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
  const existingWorkflow = await fetchWorkflowAndCheckPermission(key, userAccountId);
  const collection = await getCollection("workflows");
  const enabled = workflow.state !== "off";
  await collection.updateOne({ key }, { $set: { workflow: JSON.stringify(workflow), enabled, updatedAt: Date.now() } });
  if (enabled) {
    loadWorkflow({ key, workflow, accountId: userAccountId, workspaceKey: existingWorkflow.workspaceKey });
  } else {
    stopWorkflow(key);
  }
  track(userAccountId, "Update Workflow", {
    workflow: key,
    workspace: existingWorkflow.workspaceKey,
    role: user && "role" in user ? user.role : undefined,
    source: workflow.source || "unknown",
    title: workflow.title,
    enabled,
    triggers: workflow.trigger ? [`${workflow.trigger.connector}/${workflow.trigger.operation}`] : [],
    actions: workflow.actions.map((x) => `${x.connector}/${x.operation}`),
  });
  return { key };
}

export async function moveWorkflowToWorkspace(
  {
    key,
    newWorkspaceKey,
  }: {
    key: string;
    newWorkspaceKey: string;
  },
  { context: { user } }: { context: Context }
) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  if (!key) {
    throw new InvalidParamsError("Missing key");
  }
  await fetchWorkflowAndCheckPermission(key, userAccountId);
  if (newWorkspaceKey) {
    await checkWorkspacePermission(newWorkspaceKey, userAccountId);
  }
  const collection = await getCollection("workflows");
  await collection.updateOne(
    { key },
    {
      $set: { ...(newWorkspaceKey ? { workspaceKey: newWorkspaceKey } : {}), updatedAt: Date.now() },
      ...(newWorkspaceKey ? {} : { $unset: { workspaceKey: "" } }),
    }
  );
  track(userAccountId, "Move Workflow", { workflow: key, newWorkspace: newWorkspaceKey });
  return { key };
}

export async function listWorkflows(
  { workspaceKey }: { workspaceKey?: string },
  { context: { user } }: { context: Context }
) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  if (workspaceKey) {
    await checkWorkspacePermission(workspaceKey, userAccountId);
  }
  const collection = await getCollection("workflows");
  const result = collection.find({
    ...(workspaceKey ? {} : { userAccountId }),
    workspaceKey: workspaceKey ? { $eq: workspaceKey } : { $in: [undefined, ""] },
  });
  return (await result.toArray()).map((x: DbSchema["workflows"]) => ({
    ...x,
    workflow: JSON.parse(x.workflow),
    state: x.enabled ? "on" : "off",
  }));
}

export async function getWorkflowExecutions(
  {
    workflowKey,
    since,
    until,
    limit,
  }: {
    workflowKey: string;
    since?: number;
    until?: number;
    limit?: number;
  },
  { context: { user } }: { context: Context }
) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  if (!workflowKey) {
    throw new InvalidParamsError("Missing workflowKey");
  }
  await fetchWorkflowAndCheckPermission(workflowKey, userAccountId);
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
export async function getWorkflowExecutionLog(
  { executionId }: { executionId: string },
  { context: { user } }: { context: Context }
) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  if (!executionId) {
    throw new InvalidParamsError("Missing executionId");
  }
  const collection = await getCollection("workflowExecutions");
  const result = await collection.find({
    executionId,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ret = (await result.toArray()).map((x: any) => {
    delete x._id;
    return x as DbSchema["workflowExecutions"];
  });
  if (ret.length) {
    await fetchWorkflowAndCheckPermission(ret[0].workflowKey, userAccountId);
  }
  return ret;
}

export async function deleteWorkflow({ key }: { key: string }, { context: { user } }: { context: Context }) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  const workflow = await fetchWorkflowAndCheckPermission(key, userAccountId);
  const collection = await getCollection("workflows");
  const result = await collection.deleteOne({
    key,
  });
  stopWorkflow(key);
  let source: string | undefined;
  try {
    source = (JSON.parse(workflow.workflow) as WorkflowSchema).source;
  } catch (e) {
    console.warn(`[${workflow.key}] Failed to parse workflow: `, e);
  }
  track(userAccountId, "Delete Workflow", {
    workflow: key,
    workspace: workflow.workspaceKey,
    role: user && "role" in user ? user.role : undefined,
    source: source || "unknown",
  });
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
  if (!user) {
    throw new Error("user is required");
  }
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  track(userAccountId, "Test Action", { connector: step.connector, action: step.operation, environment });
  return await runSingleAction({ step, input, dryRun: true, environment: environment || "production", user });
}

const isAllowedUserCache = new Map<string, boolean | Promise<boolean>>();
export async function isAllowedUser(_, { context: { user } }: { context: Context }) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  if (!isAllowedUserCache.has(userAccountId)) {
    isAllowedUserCache.set(
      userAccountId,
      (async () => {
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
      })().then(
        (result) => {
          if (result) {
            isAllowedUserCache.set(userAccountId, result);
          } else {
            isAllowedUserCache.delete(userAccountId);
          }
          return result;
        },
        (e) => {
          isAllowedUserCache.delete(userAccountId);
          return Promise.reject(e);
        }
      )
    );
  }
  return await isAllowedUserCache.get(userAccountId);
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

export async function saveNotificationsState(
  {
    state,
  }: {
    state: string;
  },
  { context: { user } }: { context: Context }
) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  if (!state) {
    throw new InvalidParamsError("Missing notifications state");
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
    properties: ["nexus_notifications_state"],
    limit: 1,
    after: 0,
    sorts: [],
  });
  const newProps: { [key: string]: string } = {
    nexus_notifications_state: state,
  };
  if (resp.results[0]) {
    await hubspotClient.crm.contacts.basicApi.update(resp.results[0].id, { properties: newProps });
  } else {
    await hubspotClient.crm.contacts.basicApi.create({ properties: newProps });
  }
  return true;
}
