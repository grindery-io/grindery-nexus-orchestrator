import { RpcServerParams } from "../jsonrpc";
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
  { context: { user } }: RpcServerParams
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
  }: {
    key: string;
    displayName: string;
  },
  { context: { user } }: RpcServerParams
) {
  assert(user);
  return await callCredentialManager(
    "updateAuthCredentials",
    { key, displayName },
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await AccessToken.sign(user!, "60s")
  );
}

export async function deleteAuthCredentials(
  {
    key,
  }: {
    key: string;
  },
  { context: { user } }: RpcServerParams
) {
  assert(user);
  return await callCredentialManager(
    "deleteAuthCredentials",
    { key },
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await AccessToken.sign(user!, "60s")
  );
}

export async function putConnectorSecrets(
  {
    connectorId,
    secrets,
    environment,
  }: {
    connectorId: string;
    secrets: { [key: string]: unknown };
    environment: string;
  },
  { context: { user } }: RpcServerParams
) {
  if (!user || !("workspace" in user) || user.workspace !== "ADMIN") {
    throw new Error("Only admin can update connector secret");
  }
  return await callCredentialManager(
    "putConnectorSecrets",
    {
      connectorId,
      secrets,
      environment,
    },
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await AccessToken.sign(user!, "60s")
  );
}
