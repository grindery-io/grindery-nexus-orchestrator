import { v4 as uuidv4 } from "uuid";
import * as Sentry from "@sentry/node";
import axios from "axios";
import { getCollection } from "./db";
import { ActionSchema, ConnectorSchema, FieldSchema, OperationSchema, WorkflowSchema } from "./types";
import { ConnectorInput, ConnectorOutput, JsonRpcWebSocket } from "./ws";
import { replaceTokens } from "./utils";

const schemas: { [key: string]: ConnectorSchema | Promise<ConnectorSchema> } = {
  web3: {
    key: "web3",
    name: "Web3 connector",
    version: "1.0.0",
    platformVersion: "1.0.0",
    triggers: [
      {
        key: "newEvent",
        name: "New smart contract event",
        display: {
          label: "New smart contract event",
          description: "Trigger when a new event on specified smart contract is received",
        },
        operation: {
          type: "polling",
          operation: {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            url: process.env.WEB3_CONNECTOR_URL!,
          },
          inputFields: [
            {
              key: "chain",
              label: "Name of the blockchain",
              type: "string",
              required: true,
              default: "eth",
            },
            {
              key: "contractAddress",
              label: "Contract address",
              type: "string",
              placeholder: "0x...",
              required: true,
            },
            {
              key: "eventDeclaration",
              label: "Event declaration",
              type: "string",
              placeholder: "event EventName(address indexed param1, uint256 param2)",
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "newTransaction",
        name: "New transaction",
        display: {
          label: "New transaction",
          description: "Trigger when a new transaction is received",
        },
        operation: {
          type: "polling",
          operation: {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            url: process.env.WEB3_CONNECTOR_URL!,
          },
          inputFields: [
            {
              key: "chain",
              label: "Name of the blockchain",
              type: "string",
              required: true,
              default: "eth",
            },
            {
              key: "from",
              label: "From address",
              type: "string",
              placeholder: "0x...",
              required: false,
            },
            {
              key: "to",
              label: "To address",
              type: "string",
              placeholder: "0x...",
              required: false,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
    ],
    actions: [
      {
        key: "callSmartContract",
        name: "Call smart contract function",
        display: {
          label: "Call smart contract function",
          description: "Call a function on a smart contract",
        },
        operation: {
          type: "api",
          operation: {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            url: process.env.WEB3_CONNECTOR_URL!,
          },
          inputFields: [
            {
              key: "chain",
              label: "Name of the blockchain",
              type: "string",
              required: true,
              default: "eth",
            },
            {
              key: "contractAddress",
              label: "Contract address",
              type: "string",
              placeholder: "0x...",
              required: true,
            },
            {
              key: "functionDeclaration",
              label: "Function declaration",
              type: "string",
              placeholder: "function functionName(address param1, uint256 param2)",
              required: true,
            },
            {
              key: "maxFeePerGas",
              label: "Max fee per gas",
              type: "number",
              required: false,
            },
            {
              key: "maxPriorityFeePerGas",
              label: "Max priority fee per gas",
              type: "number",
              required: false,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
    ],
  },
};

async function getConnectorSchema(connectorId: string): Promise<ConnectorSchema> {
  if (connectorId in schemas) {
    return schemas[connectorId];
  }
  const ret = axios.get(`${process.env.CONNECTOR_SCHEMA_URL}/${connectorId}.json`).then((response) => response.data);
  schemas[connectorId] = ret;
  ret
    .then((schema) => (schemas[connectorId] = schema))
    .catch((e) => {
      console.error("Error getting connector schema", connectorId, e);
      setTimeout(function () {
        if (schemas[connectorId] === ret) {
          delete schemas[connectorId];
        }
      }, 1000 * 60 * 60);
    });
  return ret;
}
function sanitizeInput(input?: { [key: string]: unknown }, fields?: FieldSchema[]) {
  input = input || {};
  for (const field of fields || []) {
    if (!(field.key in input)) {
      if (field.default) {
        input[field.key] = field.default;
      } else if (field.required) {
        throw new Error(`Missing required field: ${field.key}`);
      }
    }
    const fieldValue = input[field.key];
    if (typeof fieldValue === "string") {
      if (field.type === "number") {
        input[field.key] = parseFloat(fieldValue.trim());
      } else if (field.type === "boolean") {
        input[field.key] = fieldValue.trim() === "true";
      }
    }
  }
  return input;
}

async function runAction({
  action,
  input,
  step,
  sessionId,
  executionId,
  dryRun,
}: {
  action: ActionSchema;
  input: { [key: string]: unknown };
  step: OperationSchema;
  sessionId: string;
  executionId: string;
  dryRun?: boolean;
}) {
  let operationKey = step.operation;
  let actionOp = action.operation;
  if (actionOp.type === "blockchain:call") {
    const web3Connector = await getConnectorSchema("web3");
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
    };
    actionOp = web3Action.operation;
  }
  if (actionOp.type === "api") {
    const url = actionOp.operation.url;
    if (!/^wss?:\/\//i.test(url)) {
      throw new Error(`Unsupported action URL: ${url}`);
    }
    const socket = new JsonRpcWebSocket(url);
    try {
      const result = (await socket.request<ConnectorInput>("runAction", {
        key: operationKey,
        sessionId,
        executionId,
        credentials: step.credentials,
        fields: { ...input, dryRun },
      })) as ConnectorOutput;
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
}: {
  step: OperationSchema;
  input: unknown;
  dryRun?: boolean;
}) {
  const connector = await getConnectorSchema(step.connector);
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
  });
}
export class RuntimeWorkflow {
  private running = false;
  private triggerSocket: JsonRpcWebSocket | null = null;
  private startCount = 0;
  private version = 0;

  constructor(private key: string, private workflow: WorkflowSchema) {}
  async start() {
    this.running = true;
    this.version++;
    this.startCount = 0;
    await this.setupTrigger();
  }
  stop() {
    this.running = false;
    this.triggerSocket?.close();
    this.version++;
    console.debug(`[${this.key}] Stopped`);
  }
  async keepAlive() {
    if (!this.running) {
      return;
    }
    const currentVersion = this.version;
    try {
      await this.triggerSocket?.request("ping");
      setTimeout(() => {
        if (this.version === currentVersion) {
          this.keepAlive();
        }
      }, parseInt(process.env.KEEPALIVE_INTERVAL || "", 10) || 60000);
    } catch (e) {
      console.warn(`[${this.key}] Failed to keep alive: ${e.toString()}`);
      this.triggerSocket?.close();
      this.setupTrigger();
    }
  }
  async onNotifySignal(payload: ConnectorOutput | undefined) {
    if (!this.running) {
      return;
    }
    if (!payload) {
      throw new Error("Invalid payload");
    }
    console.debug(`[${this.key}] Received signal`);
    this.runWorkflow(payload).catch((e) => {
      console.error(e);
      Sentry.captureException(e);
    });
  }
  async runWorkflow(initialPayload: ConnectorOutput) {
    const logCollection = await getCollection("workflowExecutions");
    const sessionId = initialPayload.sessionId;
    const executionId = uuidv4();
    await logCollection.insertOne({
      workflowKey: this.key,
      sessionId,
      executionId,
      stepIndex: -1,
      input: {},
      output: initialPayload.payload,
      startedAt: Date.now(),
      endedAt: Date.now(),
    });
    const context = {} as { [key: string]: unknown };
    context["trigger"] = initialPayload.payload;
    let index = 0;
    for (const step of this.workflow.actions) {
      console.debug(`[${this.key}] Running step ${index}: ${step.connector}/${step.operation}`);
      const connector = await getConnectorSchema(step.connector);
      const action = connector.actions?.find((action) => action.key === step.operation);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let error: any = undefined;
      let input;
      try {
        input = sanitizeInput(replaceTokens(step.input || {}, context), action?.operation?.inputFields || []);
      } catch (e) {
        error = e;
      }
      await logCollection.insertOne({
        workflowKey: this.key,
        sessionId,
        executionId,
        stepIndex: index,
        input,
        startedAt: Date.now(),
        error: error?.toString(),
      });
      if (!action) {
        throw new Error("Invalid action");
      }
      if (error) {
        return;
      }
      let nextInput: unknown;
      try {
        nextInput = await runAction({
          action,
          input,
          step,
          sessionId,
          executionId,
        });
      } catch (e) {
        console.debug(`[${this.key}] Failed step ${index}: ${e.toString()}`);
        await logCollection.updateOne(
          {
            executionId,
            stepIndex: index,
          },
          {
            $set: {
              error: e.toString(),
              endedAt: Date.now(),
            },
          }
        );
        return;
      }
      context[`step${index}`] = nextInput;
      await logCollection.updateOne(
        {
          executionId,
          stepIndex: index,
        },
        {
          $set: {
            output: nextInput,
            endedAt: Date.now(),
          },
        }
      );
      index++;
    }
    console.debug(`[${this.key}] Completed`);
  }
  async setupTrigger() {
    this.version++;
    const currentVersion = this.version;
    if (this.startCount > 10) {
      console.error(`[${this.key}] Too many attempts to setup signal, the workflow is halted`);
      return;
    }
    this.startCount++;
    await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, this.startCount) + Math.random() * 1000));
    if (!this.running || this.version !== currentVersion) {
      return;
    }
    const currentStartCount = this.startCount;
    const triggerConnector = await getConnectorSchema(this.workflow.trigger.connector);
    let trigger = triggerConnector.triggers?.find((trigger) => trigger.key === this.workflow.trigger.operation);
    if (!trigger) {
      throw new Error(`Trigger not found: ${this.workflow.trigger.connector}/${this.workflow.trigger.operation}`);
    }
    let fields = sanitizeInput(this.workflow.trigger.input, trigger.operation.inputFields || []);
    if (trigger.operation.type === "blockchain:event") {
      const web3Connector = await getConnectorSchema("web3");
      if (!web3Connector) {
        throw new Error("Web3 connector not found");
      }
      const web3Trigger = web3Connector.triggers?.find((a) => a.key === "newEvent");
      if (!web3Trigger) {
        throw new Error("Web3 trigger not found");
      }
      fields = {
        chain: fields._grinderyChain || "eth",
        contractAddress: fields._grinderyContractAddress,
        eventDeclaration: trigger.operation.signature,
        parameterFilters: fields,
      };
      trigger = web3Trigger;
    }
    if (trigger.operation.type === "hook") {
      throw new Error(`Not implemented: ${trigger.operation.type}`);
    } else if (trigger.operation.type === "polling") {
      const url = trigger.operation.operation.url;
      if (!/^wss?:\/\//i.test(url)) {
        throw new Error(`Unsupported polling URL: ${url}`);
      }
      const sessionId = uuidv4();
      console.log(`[${this.key}] Starting polling: ${sessionId} ${url}`);
      if (this.triggerSocket) {
        try {
          this.triggerSocket.close();
        } catch (e) {
          // Ignore
        }
      }
      this.triggerSocket = new JsonRpcWebSocket(url);
      this.triggerSocket.addMethod("notifySignal", this.onNotifySignal.bind(this));
      try {
        await this.triggerSocket.request<ConnectorInput>("setupSignal", {
          key: trigger.key,
          sessionId,
          credentials: this.workflow.trigger.credentials,
          fields,
        });
      } catch (e) {
        console.error(`[${this.key}] Failed to setup signal:`, e);
        setTimeout(() => this.setupTrigger().catch((e) => console.error(`[${this.key}] Unexpected failure:`, e)), 1000);
        return;
      }
      console.debug(
        `[${this.key}] Started trigger ${this.workflow.trigger.connector}/${this.workflow.trigger.operation}`
      );
      this.keepAlive();
      setTimeout(() => {
        if (this.startCount === currentStartCount && this.version === currentVersion) {
          this.startCount = 0;
        }
      }, 60000);
    } else {
      throw new Error(`Invalid trigger type: ${trigger.operation.type}`);
    }
  }
}
