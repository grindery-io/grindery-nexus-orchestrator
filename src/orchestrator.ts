import { v4 as uuidv4 } from "uuid";
import * as Sentry from "@sentry/node";

import { InvalidParamsError } from "./jsonrpc";
import { getCollection } from "./db";
import { ConnectorSchema, FieldSchema, WorkflowSchema } from "./types";
import { ConnectorInput, ConnectorOutput, JsonRpcWebSocket } from "./ws";
import { replaceTokens } from "./utils";

function verifyAccountId(accountId: string) {
  // Reference: https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-10.md
  if (typeof accountId !== "string" || !/^[-a-z0-9]{3,8}:[-a-zA-Z0-9]{1,32}:[a-zA-Z0-9]{1,64}$/.test(accountId)) {
    throw new InvalidParamsError("Invalid CAIP-10 account ID");
  }
}
async function getConnectorSchema(_connectorId: string): Promise<ConnectorSchema> {
  if (_connectorId === "helloWorld") {
    return {
      name: "Hello World",
      version: "1.0.0",
      platformVersion: "1.0.0",
      triggers: [
        {
          key: "helloWorldTrigger",
          name: "Hello World Trigger",
          display: {
            label: "Hello World Trigger",
            description: "This is a test trigger",
          },
          operation: {
            type: "polling",
            operation: {
              url: "wss://gnexus-connector-helloworld.herokuapp.com/",
            },
            inputFields: [
              {
                key: "interval",
                label: "Delay before signal in milliseconds",
                type: "number",
                required: true,
                default: "10000",
              },
              {
                key: "recurring",
                label: "Recurring",
                type: "boolean",
                required: true,
                default: "true",
              },
            ],
            outputFields: [
              {
                key: "random",
                label: "A random string",
              },
            ],
            sample: { random: "abc" },
          },
        },
      ],
      actions: [
        {
          key: "helloWorldAction",
          name: "Hello World Action",
          display: {
            label: "Hello World Action",
            description: "This is a test action",
          },
          operation: {
            type: "api",
            operation: {
              url: "wss://gnexus-connector-helloworld.herokuapp.com/",
            },
            inputFields: [
              {
                key: "message",
                label: "Message",
                type: "string",
                required: true,
                default: "Hello!",
              },
            ],
            sample: {},
          },
        },
      ],
    };
  }
  throw new Error("Not implemented");
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
class RuntimeWorkflow {
  private running = false;
  private triggerSocket: JsonRpcWebSocket | null = null;

  constructor(private key: string, private workflow: WorkflowSchema) {}
  async start() {
    this.running = true;
    await this.setupTrigger();
  }
  async keepAlive() {
    if (!this.running) {
      return;
    }
    try {
      await this.triggerSocket?.request("ping");
      setTimeout(this.keepAlive.bind(this), parseInt(process.env.KEEPALIVE_INTERVAL || "", 10) || 60000);
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
      if (action.operation.type === "blockchain:call") {
        throw new Error(`Not implemented: ${action.operation.type}`);
      } else if (action.operation.type === "api") {
        const url = action.operation.operation.url;
        if (!/^wss?:\/\//i.test(url)) {
          throw new Error(`Unsupported action URL: ${url}`);
        }
        const socket = new JsonRpcWebSocket(url);
        let nextInput: unknown;
        try {
          const result = (await socket.request<ConnectorInput>("runAction", {
            key: step.operation,
            sessionId,
            credentials: step.credentials,
            fields: input,
          })) as ConnectorOutput;
          nextInput = result.payload;
        } catch (e) {
          console.debug(`[${this.key}] Failed step ${index}: ${e.toString()}`);
          await logCollection.updateOne(
            {
              executionId,
            },
            {
              error: e.toString(),
              endedAt: Date.now(),
            }
          );
          return;
        } finally {
          socket.close();
        }
        context[`step${index}`] = nextInput;
        await logCollection.updateOne(
          {
            executionId,
          },
          {
            output: nextInput,
            endedAt: Date.now(),
          }
        );
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        throw new Error(`Invalid action type: ${(action.operation as any).type}`);
      }
      index++;
    }
    console.debug(`[${this.key}] Completed`);
  }
  async setupTrigger() {
    const triggerConnector = await getConnectorSchema(this.workflow.trigger.connector);
    const trigger = triggerConnector.triggers?.find((trigger) => trigger.key === this.workflow.trigger.operation);
    if (!trigger) {
      throw new Error(`Trigger not found: ${this.workflow.trigger.connector}/${this.workflow.trigger.operation}`);
    }
    if (trigger.operation.type === "hook") {
      throw new Error(`Not implemented: ${trigger.operation.type}`);
    } else if (trigger.operation.type === "blockchain:event") {
      throw new Error(`Not implemented: ${trigger.operation.type}`);
    } else if (trigger.operation.type === "polling") {
      const url = trigger.operation.operation.url;
      if (!/^wss?:\/\//i.test(url)) {
        throw new Error(`Unsupported polling URL: ${url}`);
      }
      const sessionId = uuidv4();
      this.triggerSocket = new JsonRpcWebSocket(url);
      this.triggerSocket.addMethod("notifySignal", this.onNotifySignal.bind(this));
      await this.triggerSocket.request<ConnectorInput>("setupSignal", {
        key: this.workflow.trigger.operation,
        sessionId,
        credentials: this.workflow.trigger.credentials,
        fields: sanitizeInput(this.workflow.trigger.input, trigger.operation.inputFields || []),
      });
      console.debug(
        `[${this.key}] Started trigger ${this.workflow.trigger.connector}/${this.workflow.trigger.operation}`
      );
      this.keepAlive();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error(`Invalid trigger type: ${(trigger.operation as any).type}`);
    }
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
    const runtimeWorkflow = new RuntimeWorkflow(workflow.key, JSON.parse(workflow.workflow));
    allWorkflows.set(workflow.key, runtimeWorkflow);
    runtimeWorkflow.start().catch((e) => {
      console.error(e);
      Sentry.captureException(e);
    });
  }
}
setTimeout(loadAllWorkflows, 1000);
export async function createWorkflow({ userAccountId, workflow }: { userAccountId: string; workflow: WorkflowSchema }) {
  verifyAccountId(userAccountId);
  const collection = await getCollection("workflows");
  const key = uuidv4();
  await collection.insertOne({
    key,
    userAccountId,
    workflow: JSON.stringify(workflow),
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const runtimeWorkflow = new RuntimeWorkflow(key, workflow);
  allWorkflows.set(key, runtimeWorkflow);
  runtimeWorkflow.start().catch((e) => {
    console.error(e);
    Sentry.captureException(e);
  });
  return { key };
}

export async function listWorkflows({ userAccountId }: { userAccountId: string }) {
  verifyAccountId(userAccountId);
  const collection = await getCollection("workflows");
  const result = await collection.find({
    userAccountId,
  });
  return (await result.toArray()).map((x) => ({ ...x, workflow: JSON.parse(x.workflow) }));
}

export async function deleteWorkflow({ userAccountId, key }: { userAccountId: string; key: string }) {
  verifyAccountId(userAccountId);
  const collection = await getCollection("workflows");
  const result = await collection.deleteOne({
    userAccountId,
    key,
  });
  return { deleted: result.deletedCount === 1 };
}
