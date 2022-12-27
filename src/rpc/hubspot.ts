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
                  propertyName: app && hsAccessProperties[app] ? hsAccessProperties[app] : "early_access__auto_",
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
  { email, source, app }: { email: string; source?: string; app?: string },
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
        {
          name: "access_status",
          value: access_status.length > 0 ? access_status.join(";") : "",
        },
        { name: "early_access_requested_from", value: source || "" },
      ],
      context: {
        pageUri: source || "",
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
