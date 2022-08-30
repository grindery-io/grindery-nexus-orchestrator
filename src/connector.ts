import axios from "axios";
import { ConnectorSchema } from "grindery-nexus-common-utils/dist/types";

const DEFAULT_SCHEMAS: { [key: string]: ConnectorSchema | Promise<ConnectorSchema> } = {
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

class SchemaCache {
  private schemas: { [key: string]: ConnectorSchema | Promise<ConnectorSchema> } = { ...DEFAULT_SCHEMAS };
  private currentCommit = "";
  private lastCommitCheck = 0;
  private urlPrefix: string;

  constructor(private environment = "production") {
    this.urlPrefix =
      process.env["CONNECTOR_SCHEMA_URL" + (environment === "production" ? "" : "_" + environment.toUpperCase())] || "";
    if (!this.urlPrefix) {
      throw new Error("No schema URL for environment: " + environment);
    }
    this.validateSchemaCache();
  }
  async validateSchemaCache() {
    if (Date.now() - this.lastCommitCheck < 60000) {
      return;
    }
    this.lastCommitCheck = Date.now();
    const commit = await axios
      .get(`${this.urlPrefix}/COMMIT`, { responseType: "text" })
      .then((response) => (response.data as string).trim())
      .catch((e) => console.error(e));
    if (!commit) {
      console.warn(`[${this.environment}] Connector schema commit not available`);
      return;
    }
    if (!this.currentCommit) {
      this.currentCommit = commit;
      console.log(`[${this.environment}] Connector schema commit: ${commit}`);
      return;
    }
    if (this.currentCommit !== commit) {
      this.currentCommit = commit;
      this.schemas = { ...DEFAULT_SCHEMAS };
      console.log(`[${this.environment}] Connector schema commit updated: ${commit}`);
    }
  }
  async getConnectorSchema(connectorId: string): Promise<ConnectorSchema> {
    this.validateSchemaCache();
    if (connectorId in this.schemas) {
      return this.schemas[connectorId];
    }
    const ret = axios.get(`${this.urlPrefix}/${connectorId}.json`).then((response) => response.data);
    this.schemas[connectorId] = ret;
    ret
      .then((schema) => (this.schemas[connectorId] = schema))
      .catch((e) => {
        console.error(`[${this.environment}] Error getting connector schema`, connectorId, e);
        setTimeout(() => {
          if (this.schemas[connectorId] === ret) {
            delete this.schemas[connectorId];
          }
        }, 1000 * 60 * 60);
      });
    return ret;
  }
}

const SCHEMA_CACHES = Object.fromEntries(["production", "staging"].map((x) => [x, new SchemaCache(x)]));

export async function getConnectorSchema(
  connectorId: string,
  envirnment: "production" | "staging" | string
): Promise<ConnectorSchema> {
  if (!(envirnment in SCHEMA_CACHES)) {
    throw new Error("Invalid environment: " + envirnment);
  }
  return await SCHEMA_CACHES[envirnment].getConnectorSchema(connectorId);
}
