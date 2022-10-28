import { v4 as uuidv4 } from "uuid";
import * as Sentry from "@sentry/node";
import { getCollection } from "./db";
import { ActionSchema, FieldSchema, OperationSchema, WorkflowSchema } from "grindery-nexus-common-utils/dist/types";
import { ConnectorInput, ConnectorOutput, JsonRpcWebSocket } from "grindery-nexus-common-utils";
import { createDebug } from "./debug";
import { getConnectorSchema } from "grindery-nexus-common-utils";
import { track } from "./tracking";
import { replaceTokens } from "grindery-nexus-common-utils/dist/utils";
import { AccessToken, TAccessToken } from "./jwt";

const debug = createDebug("runtimeWorkflow");

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
      userToken: await AccessToken.sign(user, "60s"),
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
      const requestBody = {
        key: operationKey,
        sessionId,
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
export class RuntimeWorkflow {
  private running = false;
  private triggerSocket: JsonRpcWebSocket | null = null;
  private startCount = 0;
  private version = 0;
  private keepAliveRunning = false;

  constructor(
    private key: string,
    private workflow: WorkflowSchema,
    private accountId: string,
    private environment: string,
    private workspace: string | undefined
  ) {}
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
    if (this.keepAliveRunning) {
      return;
    }
    if (!this.running) {
      return;
    }
    this.keepAliveRunning = true;
    try {
      for (;;) {
        if (!this.running) {
          return;
        }
        await new Promise((res) => setTimeout(res, parseInt(process.env.KEEPALIVE_INTERVAL || "", 10) || 60000));
        if (!this.triggerSocket?.isOpen) {
          console.warn(`[${this.key}] Not sending keep alive request because WebSocket is not open`);
        } else {
          const socket = this.triggerSocket;
          const timeout = setTimeout(() => socket.close(3003, "ping doesn't return"), 120000);
          await socket.request("ping");
          clearTimeout(timeout);
        }
      }
    } catch (e) {
      console.warn(`[${this.key}] Failed to keep alive: ${e.toString()}`);
      this.triggerSocket?.close(3002, "Failed to keep alive");
    } finally {
      this.keepAliveRunning = false;
      if (this.running) {
        this.keepAlive();
      }
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
    track(this.accountId, "Received Signal", { workflow: this.key });
    this.runWorkflow(payload).catch((e) => {
      track(this.accountId, "Workflow Error", { workflow: this.key });
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
      const connector = await getConnectorSchema(step.connector, this.environment);
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
          environment: this.environment,
          user: { sub: this.accountId, ...(this.workspace ? { workspace: this.workspace, role: "user" } : {}) },
        });
      } catch (e) {
        track(this.accountId, "Workflow Step Error", { workflow: this.key, index, error: String(e) });
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
      track(this.accountId, "Workflow Step Complete", { workflow: this.key, index });
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
    track(this.accountId, "Workflow Complete", { workflow: this.key });
    console.debug(`[${this.key}] Completed`);
  }
  async setupTrigger() {
    this.version++;
    const currentVersion = this.version;
    if (this.startCount > 10) {
      console.error(`[${this.key}] Too many attempts to setup signal, the workflow is halted`);
      const logCollection = await getCollection("workflowExecutions");
      await logCollection.insertOne({
        workflowKey: this.key,
        sessionId: "00000000-0000-0000-0000-000000000000",
        executionId: "00000000-0000-0000-0000-000000000000",
        stepIndex: -1,
        input: {},
        error: "Too many attempts to setup signal, the workflow is halted",
        startedAt: Date.now(),
        endedAt: Date.now(),
      });
      track(this.accountId, "Workflow Halted After Too Many Trigger Failures", { workflow: this.key });
      return;
    }
    this.startCount++;
    const wait = 100 * Math.pow(2, this.startCount) + Math.random() * 1000;
    if (this.startCount > 1) {
      console.log(`[${this.key}] Retrying after ${Math.floor(wait / 1000)}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
    if (!this.running || this.version !== currentVersion) {
      return;
    }
    const currentStartCount = this.startCount;
    const triggerConnector = await getConnectorSchema(this.workflow.trigger.connector, this.environment);
    let trigger = triggerConnector.triggers?.find((trigger) => trigger.key === this.workflow.trigger.operation);
    if (!trigger) {
      throw new Error(`Trigger not found: ${this.workflow.trigger.connector}/${this.workflow.trigger.operation}`);
    }
    let fields = sanitizeInput(this.workflow.trigger.input, trigger.operation.inputFields || []);
    if (trigger.operation.type === "blockchain:event") {
      const web3Connector = await getConnectorSchema("web3", this.environment);
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
    const sessionId = uuidv4();
    if (trigger.operation.type === "hook") {
      throw new Error(`Not implemented: ${trigger.operation.type}`);
    } else if (trigger.operation.type === "polling") {
      const url = trigger.operation.operation.url;
      if (!/^wss?:\/\//i.test(url)) {
        throw new Error(`Unsupported polling URL: ${url}`);
      }
      console.log(`[${this.key}] Starting polling: ${sessionId} ${url}`);
      const triggerSocket = new JsonRpcWebSocket(url);
      triggerSocket.on("close", (code, reason) => {
        console.log(`[${this.key}] WebSocket closed (${code} - ${reason})`);
        if (triggerSocket !== this.triggerSocket) {
          return;
        }
        if (!this.running) {
          return;
        }
        setTimeout(() => this.setupTrigger().catch((e) => console.error(`[${this.key}] Unexpected failure:`, e)), 1000);
      });
      if (this.triggerSocket) {
        try {
          this.triggerSocket.close();
        } catch (e) {
          // Ignore
        }
      }
      this.triggerSocket = triggerSocket;
      this.triggerSocket.addMethod("notifySignal", this.onNotifySignal.bind(this));
      try {
        const requestBody = {
          key: trigger.key,
          sessionId,
          credentials: this.workflow.trigger.credentials,
          authentication: this.workflow.trigger.authentication,
          fields,
        };
        debug("Sending setupSignal: ", requestBody);
        await this.triggerSocket.request<ConnectorInput>("setupSignal", requestBody);
      } catch (e) {
        console.error(`[${this.key}] Failed to setup signal:`, e);
        if (triggerSocket === this.triggerSocket) {
          this.triggerSocket = null;
        }
        triggerSocket.close(3001, String(e));
        const logCollection = await getCollection("workflowExecutions");
        await logCollection.insertOne({
          workflowKey: this.key,
          sessionId,
          executionId: "00000000-0000-0000-0000-000000000000",
          stepIndex: -1,
          input: {},
          error: String(e),
          startedAt: Date.now(),
          endedAt: Date.now(),
        });
        track(this.accountId, "Workflow Trigger Setup Error", { workflow: this.key, error: String(e) });
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
