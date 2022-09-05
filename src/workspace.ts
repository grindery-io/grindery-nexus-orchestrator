import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { UpdateFilter } from "mongodb";
import { v4 as uuidv4 } from "uuid";

import { DbSchema, getCollection } from "./db";
import { Context } from "./jsonrpc";
import { track } from "./tracking";

export async function createWorkspace(
  { title, iconUrl }: { title: string; iconUrl?: string },
  { context: { user } }: { context: Context }
) {
  const userAccountId = user?.sub || "";
  const collection = await getCollection("workspaces");
  const key = "ws-" + uuidv4();
  await collection.insertOne({
    key,
    title,
    iconUrl,
    creator: userAccountId,
    admins: [userAccountId],
    users: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  track(userAccountId, "Create Workspace", { workspace: key, title });
  return { key };
}

export async function throwNotFoundOrPermissionError(key: string) {
  const collection = await getCollection("workspaces");
  const workspace = await collection.findOne({ key });
  if (workspace) {
    throw new Error(`No permission in workspace: ${key}`);
  }
  throw new Error(`Workspace not found: ${key}`);
}
async function updateWorkspaceInternal(
  key: string,
  update: UpdateFilter<DbSchema["workspaces"]>,
  { context: { user } }: { context: Context }
) {
  const userAccountId = user?.sub || "";
  const collection = await getCollection("workspaces");
  const result = await collection.updateOne({ key, admins: { $in: [userAccountId] } }, update);
  if (result.matchedCount === 0) {
    await throwNotFoundOrPermissionError(key);
  }
  return { key };
}
export async function updateWorkspace(
  { key, title, iconUrl }: { key: string; title: string; iconUrl?: string },
  params: { context: Context }
) {
  const result = await updateWorkspaceInternal(
    key,
    {
      $set: {
        title,
        iconUrl,
        updatedAt: Date.now(),
      },
    },
    params
  );
  track(params.context.user?.sub || "", "Update Workspace", { workspace: key, title });
  return result;
}

export async function deleteWorkspace({ key }: { key: string }, { context: { user } }: { context: Context }) {
  const userAccountId = user?.sub || "";
  const collection = await getCollection("workspaces");
  const result = await collection.deleteOne({ key, admins: { $in: [userAccountId] } });
  if (result.deletedCount === 0) {
    await throwNotFoundOrPermissionError(key);
  }
  track(userAccountId, "Delete Workspace", { workspace: key });
  return { deleted: true };
}

export async function listWorkspaces(_, { context: { user } }: { context: Context }) {
  const userAccountId = user?.sub || "";
  const collection = await getCollection("workspaces");
  const result = collection.find({
    $or: [{ admins: { $in: [userAccountId] } }, { users: { $in: [userAccountId] } }],
  });
  return await result.toArray();
}

export async function workspaceAddUser(
  { key, accountId }: { key: string; accountId: string },
  params: { context: Context }
) {
  if (!accountId) {
    throw new InvalidParamsError("accountId is missing");
  }
  const result = await updateWorkspaceInternal(
    key,
    {
      $set: {
        updatedAt: Date.now(),
      },
      $addToSet: {
        users: accountId,
      },
    },
    params
  );
  track(params.context.user?.sub || "", "Workspace Add User", { workspace: key });
  return result;
}

export async function workspaceRemoveUser(
  { key, accountId }: { key: string; accountId: string },
  params: { context: Context }
) {
  if (!accountId) {
    throw new InvalidParamsError("accountId is missing");
  }
  const result = await updateWorkspaceInternal(
    key,
    {
      $set: {
        updatedAt: Date.now(),
      },
      $pull: {
        users: accountId,
      },
    },
    params
  );
  track(params.context.user?.sub || "", "Workspace Remove User", { workspace: key });
  return result;
}

export async function workspaceAddAdmin(
  { key, accountId }: { key: string; accountId: string },
  params: { context: Context }
) {
  if (!accountId) {
    throw new InvalidParamsError("accountId is missing");
  }
  const result = await updateWorkspaceInternal(
    key,
    {
      $set: {
        updatedAt: Date.now(),
      },
      $addToSet: {
        admins: accountId,
      },
    },
    params
  );
  track(params.context.user?.sub || "", "Workspace Add Admin", { workspace: key });
  return result;
}

export async function workspaceRemoveAdmin(
  { key, accountId }: { key: string; accountId: string },
  params: { context: Context }
) {
  if (!accountId) {
    throw new InvalidParamsError("accountId is missing");
  }
  if (accountId === params.context.user?.sub) {
    throw new InvalidParamsError("Can't remove self from admin list");
  }
  const result = await updateWorkspaceInternal(
    key,
    {
      $set: {
        updatedAt: Date.now(),
      },
      $pull: {
        admins: accountId,
      },
    },
    params
  );
  track(params.context.user?.sub || "", "Workspace Remove Admin", { workspace: key });
  return result;
}
