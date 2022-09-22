import { Context } from "../jsonrpc";
import { callCredentialManager } from "../credentialManagerClient";
import { AccessToken } from "../jwt";
import { assert } from "console";

export async function listAuthCredentials(
  {
    connectorId,
    environment,
  }: {
    connectorId: string;
    environment: string;
  },
  { context: { user } }: { context: Context }
) {
  assert(user);
  return await callCredentialManager(
    "getAuthCredentialsDisplayInfo",
    { connectorId, environment },
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await AccessToken.sign(user!, "60s")
  );
}

export async function updateAuthCredentials(
  {
    key,
    displayName,
    environment,
  }: {
    key: string;
    displayName: string;
    environment: string;
  },
  { context: { user } }: { context: Context }
) {
  assert(user);
  return await callCredentialManager(
    "updateAuthCredentials",
    { key, displayName, environment },
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await AccessToken.sign(user!, "60s")
  );
}

export async function deleteAuthCredentials(
  {
    key,
    environment,
  }: {
    key: string;
    environment: string;
  },
  { context: { user } }: { context: Context }
) {
  assert(user);
  return await callCredentialManager(
    "deleteAuthCredentials",
    { key, environment },
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await AccessToken.sign(user!, "60s")
  );
}
