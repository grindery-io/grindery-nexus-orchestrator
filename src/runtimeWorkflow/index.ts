import { v4 as uuidv4 } from "uuid";
import * as Sentry from "@sentry/node";
import { getCollection } from "../db";
import { WorkflowSchema } from "grindery-nexus-common-utils/dist/types";
import { ConnectorInput, ConnectorOutput, getAdaptiveConnection, IJsonRpcClient } from "grindery-nexus-common-utils";
import { createDebug } from "../debug";
import { getConnectorSchema } from "grindery-nexus-common-utils";
import { track as _track } from "../tracking";
import { replaceTokens } from "grindery-nexus-common-utils/dist/utils";
import { AccessToken, TAccessToken } from "../jwt";
import { sanitizeInput } from "./utils";
import { runAction } from "./action";
import EventEmitter from "node:events";

export * from "./action";

export const debug = createDebug("runtimeWorkflow");

abstract class RuntimeWorkflowBase {
  protected running = false;
  protected triggerSocket: IJsonRpcClient | null = null;
  protected startCount = 0;
  protected version = 0;
  protected keepAliveRunning = false;
  protected setupTriggerRunning = false;

  constructor(
    protected key: string,
    protected workflow: WorkflowSchema,
    protected accountId: string,
    protected environment: string,
    protected workspace: string | undefined
  ) {}
  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.version++;
    this.startCount = 0;
    await this.setupTrigger();
  }
  stop() {
    const running = this.running;
    this.running = false;
    this.triggerSocket?.close();
    this.version++;
    if (running) {
      console.debug(`[${this.key}] Stopped`);
    }
  }
  async keepAlive() {
    if (this.keepAliveRunning) {
      return;
    }
    if (!this.running || !this.triggerSocket) {
      return;
    }
    this.keepAliveRunning = true;
    const keepAliveInterval = parseInt(process.env.KEEPALIVE_INTERVAL || "", 10) || 60000;
    try {
      for (;;) {
        if (!this.running || !this.triggerSocket) {
          return;
        }
        await new Promise((res) => setTimeout(res, keepAliveInterval * 0.9 + Math.random() * keepAliveInterval * 0.2));
        if (!this.triggerSocket?.isOpen) {
          console.warn(`[${this.key}] Not sending keep alive request because WebSocket is not open`);
        } else {
          const socket = this.triggerSocket;
          let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
            timeout = null;
            console.warn(`[${this.key}] Keep alive: Ping doesn't return`);
            socket.close(3003, "ping doesn't return");
          }, 120000);
          try {
            await socket.request("ping");
          } finally {
            if (timeout) {
              clearTimeout(timeout);
            }
          }
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
  private async onNotifySignal(payload: ConnectorOutput | undefined) {
    if (!this.running) {
      return;
    }
    if (!payload) {
      throw new Error("Invalid payload");
    }
    console.debug(`[${this.key}] Received signal`);
    return await this.handleSignal(payload);
  }
  protected abstract handleSignal(payload: ConnectorOutput | undefined): Promise<unknown>;
  protected getUser(): TAccessToken {
    return { sub: this.accountId, ...(this.workspace ? { workspace: this.workspace, role: "user" } : {}) };
  }
  private async getState(key: string): Promise<unknown> {
    if (!key) {
      throw new Error("Missing key");
    }
    if (typeof key !== "string") {
      throw new Error("key must be a string");
    }
    const db = await getCollection("workflowStates");
    const doc = await db.findOne({ workflowKey: this.key, stepIndex: -1, stateKey: key });
    if (!doc) {
      return null;
    }
    try {
      return JSON.parse(doc.value);
    } catch (e) {
      console.warn(`[${this.key}] Invalid state ${key}: ${doc.value}`, e);
    }
    return null;
  }
  private async setState(key: string, value: unknown) {
    if (!key) {
      throw new Error("Missing key");
    }
    if (typeof key !== "string") {
      throw new Error("key must be a string");
    }
    const db = await getCollection("workflowStates");
    await db.updateOne(
      { workflowKey: this.key, stepIndex: -1, stateKey: key },
      {
        $set: {
          workflowKey: this.key,
          stepIndex: -1,
          stateKey: key,
          value: JSON.stringify(value),
          updatedAt: Date.now(),
        },
        $setOnInsert: {
          createdAt: Date.now(),
        },
      },
      { upsert: true }
    );
  }
  async setupTrigger() {
    if (this.setupTriggerRunning) {
      return;
    }
    this.setupTriggerRunning = true;
    try {
      return await this._setupTrigger();
    } finally {
      this.setupTriggerRunning = false;
    }
  }
  private retrySetup() {
    setTimeout(
      () =>
        this.setupTrigger().catch((e) => {
          console.error(`[${this.key}] Unexpected failure:`, e);
          this.retrySetup();
        }),
      1000
    );
  }
  private async _setupTrigger() {
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
      this.track(this.accountId, "Workflow Halted After Too Many Trigger Failures", { workflow: this.key });
      this.stop();
      return;
    }
    this.startCount++;
    const wait = 100 * Math.pow(2, this.startCount) + Math.random() * 1000;
    if (this.startCount > 1) {
      console.log(`[${this.key}] Retrying after ${Math.floor(wait / 1000)}s`);
      try {
        this.triggerSocket?.close();
      } catch (e) {
        // Ignore
      }
      this.triggerSocket = null;
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
    if (!this.running || this.version !== currentVersion) {
      return;
    }
    const currentStartCount = this.startCount;
    const cdsName = this.workflow.trigger.connector;
    const triggerConnector = await getConnectorSchema(cdsName, this.environment);
    let trigger = triggerConnector.triggers?.find((trigger) => trigger.key === this.workflow.trigger.operation);
    if (!trigger) {
      throw new Error(`Trigger not found: ${cdsName}/${this.workflow.trigger.operation}`);
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
    if ("requiresUserToken" in trigger.operation && trigger.operation.requiresUserToken) {
      fields._grinderyUserToken = await AccessToken.sign(this.getUser(), "60s");
    }
    const sessionId = uuidv4();
    if (trigger.operation.type === "hook") {
      throw new Error(`Not implemented: ${trigger.operation.type}`);
    } else if (trigger.operation.type === "polling") {
      const url = trigger.operation.operation.url;
      if (!/^wss?:\/\//i.test(url)) {
        throw new Error(`Unsupported polling URL: ${url}`);
      }
      const triggerSocket = await getAdaptiveConnection(url).catch((e) => {
        console.error(`[${this.key}] Failed to create WebSocket connection`, e);
        this.retrySetup();
      });
      if (!triggerSocket) {
        return;
      }
      console.log(`[${this.key}] Starting polling: ${sessionId} ${url}`);
      triggerSocket.once("close", (code, reason) => {
        console.log(`[${this.key}] WebSocket closed (${code} - ${reason})`);
        if (triggerSocket !== this.triggerSocket) {
          return;
        }
        if (!this.running) {
          return;
        }
        this.retrySetup();
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
      this.triggerSocket.addMethod(
        "getState",
        async (input: { sessionId: string; payload: { key: string } } | undefined): Promise<unknown> =>
          await this.getState(input?.payload?.key || "")
      );
      this.triggerSocket.addMethod(
        "setState",
        async (input: { sessionId: string; payload: { key: string; value: unknown } } | undefined) =>
          await this.setState(input?.payload?.key || "", input?.payload?.value)
      );
      try {
        const requestBody = {
          key: trigger.key,
          sessionId,
          cdsName,
          credentials: this.workflow.trigger.credentials,
          authentication: this.workflow.trigger.authentication,
          initStates: await this.getState("initStates"),
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
        this.track(this.accountId, "Workflow Trigger Setup Error", { workflow: this.key, error: String(e) });
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
  protected track(_accountId: string, _event: string, _properties: { [key: string]: unknown } = {}) {
    /* Placeholder intended to be overridden */
  }
}

export class RuntimeWorkflow extends RuntimeWorkflowBase {
  protected track(accountId: string, event: string, properties: { [key: string]: unknown } = {}) {
    _track(accountId, event, properties);
  }
  protected async handleSignal(payload: ConnectorOutput) {
    this.track(this.accountId, "Received Signal", { workflow: this.key });
    this.runWorkflow(payload).catch((e) => {
      this.track(this.accountId, "Workflow Error", { workflow: this.key });
      console.error(e);
      Sentry.captureException(e);
    });
  }
  private async runWorkflow(initialPayload: ConnectorOutput) {
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
          user: this.getUser(),
        });
      } catch (e) {
        this.track(this.accountId, "Workflow Step Error", { workflow: this.key, index, error: String(e) });
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
      this.track(this.accountId, "Workflow Step Complete", { workflow: this.key, index });
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
    this.track(this.accountId, "Workflow Complete", { workflow: this.key });
    console.debug(`[${this.key}] Completed`);
  }
}

export class StandaloneWorkflowTrigger extends RuntimeWorkflowBase {
  private emitter = new EventEmitter();

  on(event: "signal", listener: (payload: ConnectorOutput) => void) {
    this.emitter.on(event, listener);
  }
  off(event: "signal", listener: (payload: ConnectorOutput) => void) {
    this.emitter.off(event, listener);
  }
  protected async handleSignal(payload: ConnectorOutput) {
    this.emitter.emit("signal", payload);
  }
}
