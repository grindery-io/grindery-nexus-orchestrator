import { JSONRPCServer, JSONRPCClient, JSONRPCServerAndClient, JSONRPCParams } from "json-rpc-2.0";
import WebSocket from "ws";

type WebSocketPayloadCommon = {
  key: string;
  sessionId: string;
};
export type ConnectorInput = WebSocketPayloadCommon & {
  executionId?: string;
  credentials: unknown;
  fields: unknown;
};
export type ConnectorOutput = WebSocketPayloadCommon & {
  payload: unknown;
};

export class JsonRpcWebSocket {
  private serverAndClient: JSONRPCServerAndClient;
  private ws: WebSocket;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.serverAndClient = new JSONRPCServerAndClient(
      new JSONRPCServer(),
      new JSONRPCClient(async (request) => {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(request));
          return;
        }
        if (this.ws.readyState !== WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open");
        }
        await new Promise((resolve, reject) => {
          const onError = function (e) {
            reject(e || new Error("Failed to send request to WebSocket"));
          };
          this.ws.on("error", onError);
          this.ws.on("close", onError);
          this.ws.once("open", () => {
            this.ws.off("error", onError);
            this.ws.off("close", onError);
            try {
              this.ws.send(JSON.stringify(request));
            } catch (error) {
              reject(error);
              return;
            }
            resolve(undefined);
          });
        });
      })
    );
    this.ws.onmessage = (event) => {
      this.serverAndClient.receiveAndSend(JSON.parse(event.data.toString()));
    };
    this.ws.onclose = (event) => {
      this.serverAndClient.rejectAllPendingRequests(`Connection is closed (${event.reason}).`);
    };
    this.ws.onerror = (e) => {
      console.error("WebSocket error:", e);
      this.ws.close();
      this.serverAndClient.rejectAllPendingRequests(`Connection error: ${e.toString()}`);
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addMethod<T extends Record<string, unknown>>(name: string, method: (params: T | undefined) => PromiseLike<any>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.serverAndClient.addMethod(name, method as any);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request<T extends JSONRPCParams, U = unknown>(method: string, params?: T, clientParams?: any): PromiseLike<U> {
    let running = true;
    const keepAlive = () => {
      if (!running) {
        return;
      }
      setTimeout(() => {
        if (!running) {
          return;
        }
        this.serverAndClient
          .timeout(5000)
          .request("ping")
          .then(keepAlive, () => console.error(`WebSocket connection is closed while calling ${method}`));
      }, 5000);
    };
    keepAlive();
    try {
      return this.serverAndClient.timeout(60000).request(method, params, clientParams);
    } finally {
      running = false;
    }
  }
  close() {
    this.ws.close();
  }
}
