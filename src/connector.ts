import axios from "axios";
import { ConnectorSchema } from "./types";

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
export async function getConnectorSchema(connectorId: string): Promise<ConnectorSchema> {
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
