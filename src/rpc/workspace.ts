import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { UpdateFilter } from "mongodb";
import { v4 as uuidv4 } from "uuid";

import { DbSchema, getCollection } from "../db";
import { RpcServerParams } from "../jsonrpc";
import { AccessToken } from "../jwt";
import { track } from "../tracking";

export async function createWorkspace(
  {
    title,
    iconUrl,
    about,
    admins,
    users,
  }: { title: string; iconUrl?: string; about?: string; admins?: string[]; users?: string[] },
  { context: { user } }: RpcServerParams
) {
  const userAccountId = user?.sub || "";
  admins = admins || [userAccountId];
  users = users || [];
  if (!Array.isArray(admins)) {
    throw new InvalidParamsError("admins must be an array");
  }
  if (!Array.isArray(users)) {
    throw new InvalidParamsError("users must be an array");
  }
  if (!admins.includes(userAccountId)) {
    throw new InvalidParamsError("admins must include current user");
  }
  const collection = await getCollection("workspaces");
  const key = "ws-" + uuidv4();
  await collection.insertOne({
    key,
    title,
    iconUrl,
    about,
    creator: userAccountId,
    admins,
    users,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  track(userAccountId, "Create Workspace", { workspace: key, title });
  return {
    key,
    token: await AccessToken.sign(
      {
        sub: user?.sub,
        workspace: key,
        role: "admin",
      },
      user?.exp || "1h"
    ),
  };
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
  { context: { user } }: RpcServerParams
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
  {
    key,
    title,
    iconUrl,
    about,
    admins,
    users,
  }: { key: string; title?: string; iconUrl?: string; about?: string; admins?: string[]; users?: string[] },
  params: RpcServerParams
) {
  const userAccountId = params.context.user?.sub || "";
  if (admins) {
    if (!Array.isArray(admins)) {
      throw new InvalidParamsError("admins must be an array");
    }
    if (!admins.includes(userAccountId)) {
      throw new InvalidParamsError("admins must include current user");
    }
  }
  if (users && !Array.isArray(users)) {
    throw new InvalidParamsError("users must be an array");
  }
  const result = await updateWorkspaceInternal(
    key,
    {
      $set: {
        ...(title === undefined ? {} : { title }),
        ...(iconUrl === undefined ? {} : { iconUrl }),
        ...(about === undefined ? {} : { about }),
        ...(admins ? { admins } : {}),
        ...(users ? { users } : {}),
        updatedAt: Date.now(),
      },
    },
    params
  );
  track(params.context.user?.sub || "", "Update Workspace", { workspace: key, title });
  return result;
}

export async function deleteWorkspace({ key }: { key: string }, { context: { user } }: RpcServerParams) {
  const userAccountId = user?.sub || "";
  const workflowCollection = await getCollection("workflows");
  if ((await workflowCollection.countDocuments({ workspaceKey: key }, { limit: 1 })) > 0) {
    throw new Error("Can't delete a workspace that contains workflow");
  }
  const collection = await getCollection("workspaces");
  const result = await collection.deleteOne({ key, admins: { $in: [userAccountId] } });
  if (result.deletedCount === 0) {
    await throwNotFoundOrPermissionError(key);
  }
  track(userAccountId, "Delete Workspace", { workspace: key });
  return { deleted: true };
}

export async function leaveWorkspace({ key }: { key: string }, { context: { user } }: RpcServerParams) {
  const userAccountId = user?.sub || "";
  const collection = await getCollection("workspaces");
  const result = await collection.findOne({ key });
  if (!result) {
    throw new Error(`Workspace not found: ${key}`);
  }
  if (!result.users.includes(userAccountId) && !result.admins.includes(userAccountId)) {
    throw new Error(`User ${userAccountId} is not in this workspace: ${key}`);
  }
  if (result.admins.length === 1 && result.admins[0] === userAccountId) {
    throw new Error(`Can't leave workspace ${key} because user ${userAccountId} is the only admin in the workspace`);
  }
  await collection.updateOne(
    { key },
    {
      $set: {
        // Not using $pull to avoid race condition
        ...(result.admins.includes(userAccountId) ? { admins: result.admins.filter((x) => x !== userAccountId) } : {}),
        updatedAt: Date.now(),
      },
      $pull: {
        users: userAccountId,
      },
    }
  );
  track(userAccountId, "Leave Workspace", { workspace: key });
  return { left: true };
}

export async function listWorkspaces(
  _,
  { context: { user } }: RpcServerParams
): Promise<(DbSchema["workspaces"] & { token: string })[]> {
  const userAccountId = user?.sub || "";
  const collection = await getCollection("workspaces");
  const result = collection.find({
    $or: [{ admins: { $in: [userAccountId] } }, { users: { $in: [userAccountId] } }],
  });
  const items = (await result.toArray()).map((x) => ({ ...x, token: "" }));
  for (const item of items) {
    if (user && "workspaceRestricted" in user && user.workspaceRestricted && item.key !== user.workspace) {
      continue;
    }
    item.token = await AccessToken.sign(
      {
        sub: user?.sub,
        workspace: item.key,
        role: item.admins.includes(userAccountId) ? "admin" : "user",
      },
      user?.exp || "1h"
    );
  }
  return items;
}

export async function workspaceAddUser(
  { key, accountId }: { key: string; accountId: string },
  params: RpcServerParams
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
  params: RpcServerParams
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
  params: RpcServerParams
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
  params: RpcServerParams
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
