import { identify, track } from "../tracking";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { RpcServerParams } from "../jsonrpc";
import { verifyAccountId } from "./orchestrator";
import { getCollection } from "../db";

const isAllowedUserCache = new Map<string, boolean | Promise<boolean>>();
export async function isAllowedUser({ app }: { app?: string }, { context: { user } }: RpcServerParams) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  const hsAccessProperties = {
    flow: "early_access__auto___flow_",
    ping: "early_access__auto___ping_",
    gateway: "early_access__auto___gateway_",
    cds: "early_access__auto___cds_editor_",
  };
  const userAccount = app ? `${app}:${userAccountId}` : userAccountId;
  if (!isAllowedUserCache.has(userAccount)) {
    isAllowedUserCache.set(
      userAccount,
      (async () => {
        const usersCollection = await getCollection("users");
        const filter = { ceramic_did: userAccountId };
        if (app) {
          filter[hsAccessProperties[app] || "doi_confirmed__auto_"] = true;
        }
        const userDoc = await usersCollection.findOne(filter);

        if (userDoc) {
          return true;
        }
        return (process.env.ALLOWED_USERS || "").split(",").includes(userAccountId);
      })().then(
        (result) => {
          if (result) {
            isAllowedUserCache.set(userAccount, result);
          } else {
            isAllowedUserCache.delete(userAccount);
          }
          return result;
        },
        (e) => {
          isAllowedUserCache.delete(userAccount);
          return Promise.reject(e);
        }
      )
    );
  }
  return await isAllowedUserCache.get(userAccount);
}

export async function requestEarlyAccess(
  {
    email,
    source,
    app,
    interest,
    skill,
    firstname,
    lastname,
    hutk,
    pageName,
    ipAddress,
    trackSource,
  }: {
    email: string;
    source?: string;
    app?: string;
    interest?: string;
    skill?: string;
    firstname?: string;
    lastname?: string;
    hutk?: string;
    pageName?: string;
    ipAddress?: string;
    trackSource?: string;
  },
  { context: { user } }: RpcServerParams
) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  if (!email) {
    throw new InvalidParamsError("Missing email");
  }
  if (!/^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(email)) {
    throw new InvalidParamsError("Invalid email");
  }
  const usersCollection = await getCollection("users");
  const userDoc = await usersCollection.findOne({ ceramic_did: userAccountId });

  const access_status = userDoc?.access_status?.split(";") || [];
  if (app) {
    access_status.push(app);
  }
  await usersCollection.updateOne(
    { ceramic_did: userAccountId },
    {
      $set: {
        email,
        interest,
        skill,
        firstname,
        lastname,
        access_status: access_status.join(";"),
        early_access_requested_from: source,
        earlyAccessSubmissionContext: {
          hutk,
          pageUri: source,
          pageName,
          ipAddress,
        },
        legalConsentOptions: {
          consent: {
            consentToProcess: true,
            text: "I agree to allow Grindery - New to store and process my personal data.",
            communications: [
              {
                value: true,
                subscriptionTypeId: 47617892,
                text: "I agree to receive other communications from Grindery - New.",
              },
            ],
          },
        },
      },
    },
    { upsert: true }
  );
  identify(userAccountId, { email });
  track(userAccountId, "[NEXUS] Email Captured", { email, source: trackSource || "unknown" });
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
  { context: { user } }: RpcServerParams
) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  if (!walletAddress) {
    throw new InvalidParamsError("Missing walletAddress");
  }
  if (email && !/^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(email)) {
    throw new InvalidParamsError("Invalid email");
  }
  const usersCollection = await getCollection("users");
  const userDoc = await usersCollection.findOne({ ceramic_did: userAccountId });

  const newProps: { [key: string]: string } = {
    wallet_address: walletAddress,
  };
  if (email) {
    newProps.email = email;
    identify(userAccountId, { email });
  } else if (!userDoc?.email) {
    newProps.email = `${walletAddress}@wallet.grindery.org`;
  }
  await usersCollection.updateOne(
    { ceramic_did: userAccountId },
    {
      $set: newProps,
    },
    { upsert: true }
  );
  return true;
}

const isUserHasEmailCache = new Map<string, boolean | Promise<boolean>>();
export async function isUserHasEmail(_, { context: { user } }: RpcServerParams) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  const userAccount = userAccountId;
  if (!isUserHasEmailCache.has(userAccount)) {
    isUserHasEmailCache.set(
      userAccount,
      (async () => {
        const usersCollection = await getCollection("users");
        const userDoc = await usersCollection.findOne({ ceramic_did: userAccountId, email: { $exists: true } });

        if (userDoc?.email) {
          return true;
        }
        return (process.env.ALLOWED_USERS || "").split(",").includes(userAccountId);
      })().then(
        (result) => {
          if (result) {
            isUserHasEmailCache.set(userAccount, result);
          } else {
            isUserHasEmailCache.delete(userAccount);
          }
          return result;
        },
        (e) => {
          isUserHasEmailCache.delete(userAccount);
          return Promise.reject(e);
        }
      )
    );
  }
  return await isUserHasEmailCache.get(userAccount);
}
export function deleteUserFromCache(userAccountId: string) {
  isAllowedUserCache.delete(userAccountId);
  isUserHasEmailCache.delete(userAccountId);
}

export async function updateUserEmail({ email }: { email: string }, { context: { user } }: RpcServerParams) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  if (!email) {
    throw new InvalidParamsError("Missing email");
  }
  if (!/^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(email)) {
    throw new InvalidParamsError("Invalid email");
  }
  const usersCollection = await getCollection("users");
  const userDoc = await usersCollection.findOne({ ceramic_did: userAccountId });
  if (!userDoc) {
    return false;
  }
  const updateRes = await usersCollection.updateOne(
    { ceramic_did: userAccountId },
    {
      $set: {
        email,
      },
    },
    { upsert: true }
  );

  if (updateRes.modifiedCount > 0 || updateRes.upsertedCount > 0) {
    track(userAccountId, "Email updated", { email });
    return true;
  } else {
    return false;
  }
}

export async function getUserEmail(_, { context: { user } }: RpcServerParams) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  const usersCollection = await getCollection("users");
  const userDoc = await usersCollection.findOne({ ceramic_did: userAccountId });
  return userDoc?.email || null;
}

export async function getUserProps({ props }: { props?: string[] }, { context: { user } }: RpcServerParams) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  const usersCollection = await getCollection("users");
  const userDoc = await usersCollection.findOne({ ceramic_did: userAccountId });
  const properties = props && props.length > 0 ? props : ["email", "firstname", "lastname", "interest", "skill"];
  let userProps = {
    ceramic_did: userAccountId,
  };
  for (const prop of properties) {
    userProps[prop] = userDoc?.[prop];
  }
  return userProps;
}

export async function updateUserProps(
  { props }: { props: { email?: string; firstname?: string; lastname?: string; interest?: string; skill?: string } },
  { context: { user } }: RpcServerParams
) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  if (!props.email) {
    throw new InvalidParamsError("Missing email");
  }
  if (!/^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(props.email)) {
    throw new InvalidParamsError("Invalid email");
  }
  const usersCollection = await getCollection("users");
  const updateRes = await usersCollection.updateOne(
    { ceramic_did: userAccountId },
    {
      $set: props,
    },
    { upsert: true }
  );

  if (updateRes.modifiedCount > 0 || updateRes.upsertedCount > 0) {
    track(userAccountId, "Properties updated", props);
    return true;
  } else {
    return false;
  }
}
