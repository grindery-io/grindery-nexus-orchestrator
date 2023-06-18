import { v4 as uuidv4 } from "uuid";
import { ActionSchema, OperationSchema } from "grindery-nexus-common-utils/dist/types";
import { ConnectorInput, ConnectorOutput, JsonRpcWebSocket } from "grindery-nexus-common-utils";
import { getConnectorSchema } from "grindery-nexus-common-utils";
import { AccessToken, TAccessToken } from "../jwt";
import { debug } from "./index";

export async function runAction({
  action,
  input,
  step,
  sessionId,
  executionId,
  dryRun,
  environment,
  user,
}: {
  action: ActionSchema;
  input: { [key: string]: unknown };
  step: OperationSchema;
  sessionId: string;
  executionId: string;
  dryRun?: boolean;
  environment: string;
  user: TAccessToken;
}) {
  let operationKey = step.operation;
  let actionOp = action.operation;
  const cdsName = step.connector;
  if (actionOp.type === "blockchain:call") {
    const web3Connector = await getConnectorSchema("web3", environment);
    if (!web3Connector) {
      throw new Error("Web3 connector not found");
    }
    operationKey = "callSmartContract";
    const web3Action = web3Connector.actions?.find((a) => a.key === operationKey);
    if (!web3Action) {
      throw new Error("Web3 call action not found");
    }
    const inputObj = input as { [key: string]: unknown };
    input = {
      chain: inputObj._grinderyChain || "eth",
      contractAddress: inputObj._grinderyContractAddress,
      functionDeclaration: actionOp.signature,
      parameters: inputObj,
      maxFeePerGas: inputObj._grinderyMaxFeePerGas,
      maxPriorityFeePerGas: inputObj._grinderyMaxPriorityFeePerGas,
      userToken: await AccessToken.sign(user, "60s"), // Deprecated, remove this after web3 driver switches to _grinderyUserToken
    };
    actionOp = web3Action.operation;
  }
  if ("requiresUserToken" in actionOp && actionOp.requiresUserToken) {
    input._grinderyUserToken = await AccessToken.sign(user, "60s");
  }
  if (actionOp.type === "api") {
    const url = actionOp.operation.url;
    if (!/^wss?:\/\//i.test(url)) {
      throw new Error(`Unsupported action URL: ${url}`);
    }
    const socket = new JsonRpcWebSocket(url);
    try {
      const requestBody = {
        key: operationKey,
        sessionId,
        cdsName,
        executionId,
        credentials: step.credentials,
        authentication: step.authentication,
        fields: { ...input, dryRun },
      };
      debug("Sending runAction: ", requestBody);
      const result = (await socket.request<ConnectorInput>("runAction", requestBody)) as ConnectorOutput;
      return result.payload;
    } finally {
      socket.close();
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new Error(`Invalid action type: ${actionOp.type}`);
  }
}
export async function runSingleAction({
  step,
  input,
  dryRun,
  environment,
  user,
}: {
  step: OperationSchema;
  input: unknown;
  dryRun?: boolean;
  environment: string;
  user: TAccessToken;
}) {
  const connector = await getConnectorSchema(step.connector, environment);
  const action = connector.actions?.find((action) => action.key === step.operation);
  if (!action) {
    throw new Error("Invalid action");
  }
  return await runAction({
    action,
    input: input as { [key: string]: unknown },
    step,
    sessionId: uuidv4(),
    executionId: uuidv4(),
    dryRun,
    environment,
    user,
  });
}
