import { Client as HubSpotClient } from "@hubspot/api-client";
import axios from "axios";
import { identify, track } from "../tracking";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { RpcServerParams } from "../jsonrpc";
import { verifyAccountId } from "./orchestrator";

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
                  propertyName: app && hsAccessProperties[app] ? hsAccessProperties[app] : "doi_confirmed__auto_",
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
    properties: ["email", "access_status"],
    limit: 1,
    after: 0,
    sorts: [],
  });
  const access_status = resp.results?.[0]?.properties?.access_status?.split(";") || [];
  if (app) {
    access_status.push(app);
  }
  await axios.post(
    `https://api.hsforms.com/submissions/v3/integration/submit/${process.env.HS_PORTAL_ID}/${process.env.HS_EARLY_ACCESS_FORM}`,
    {
      fields: [
        { name: "email", value: email },
        { name: "ceramic_did", value: userAccountId },
        { name: "firstname", value: firstname || "" },
        { name: "lastname", value: lastname || "" },
        { name: "interest", value: interest || "" },
        { name: "skill", value: skill || "" },
        {
          name: "access_status",
          value: access_status.length > 0 ? access_status.join(";") : "",
        },
        { name: "early_access_requested_from", value: source || "" },
      ],
      context: {
        hutk: hutk || undefined,
        pageUri: source || undefined,
        pageName: pageName || undefined,
        ipAddress: ipAddress || undefined,
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
    }
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

const isUserHasEmailCache = new Map<string, boolean | Promise<boolean>>();
export async function isUserHasEmail(_, { context: { user } }: RpcServerParams) {
  const userAccountId = user?.sub || "";
  verifyAccountId(userAccountId);
  const userAccount = userAccountId;
  if (!isUserHasEmailCache.has(userAccount)) {
    isUserHasEmailCache.set(
      userAccount,
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
                  propertyName: "email",
                  operator: "HAS_PROPERTY",
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
  const hubspotClient = new HubSpotClient({ accessToken: process.env.HS_PRIVATE_TOKEN });
  let contact;
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
  if (resp.results.length) {
    contact = resp.results[0];
  }
  if (!contact) {
    return false;
  }
  const updateRes = await hubspotClient.crm.contacts.basicApi.update(contact.id, {
    properties: { email },
  });
  if (updateRes && updateRes.id) {
    track(userAccountId, "Email updated", { email });
    return true;
  } else {
    return false;
  }
}

export async function getUserEmail(_, { context: { user } }: RpcServerParams) {
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
        ],
      },
    ],
    properties: ["email"],
    limit: 1,
    after: 0,
    sorts: [],
  });
  return resp.results?.[0]?.properties?.email || null;
}

export async function getUserProps({ props }: { props?: string[] }, { context: { user } }: RpcServerParams) {
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
        ],
      },
    ],
    properties: props && props.length > 0 ? props : ["email", "firstname", "lastname", "interest", "skill"],
    limit: 1,
    after: 0,
    sorts: [],
  });
  return resp.results?.[0]?.properties || null;
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
  const hubspotClient = new HubSpotClient({ accessToken: process.env.HS_PRIVATE_TOKEN });
  let contact;
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
  if (resp.results.length) {
    contact = resp.results[0];
  }
  if (!contact) {
    return false;
  }
  const updateRes = await hubspotClient.crm.contacts.basicApi.update(contact.id, {
    properties: props,
  });
  if (updateRes && updateRes.id) {
    track(userAccountId, "Properties updated", props);
    return true;
  } else {
    return false;
  }
}
