import { v4 as uuidv4 } from "uuid";
import * as Sentry from "@sentry/node";
import { getCollection } from "./db";
import { ActionSchema, ConnectorSchema, FieldSchema, OperationSchema, WorkflowSchema } from "./types";
import { ConnectorInput, ConnectorOutput, JsonRpcWebSocket } from "./ws";
import { replaceTokens } from "./utils";

const schemas: { [key: string]: ConnectorSchema } = {
  helloWorld: {
    key: "helloWorld",
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
          outputFields: [
            {
              key: "message",
            },
          ],
          sample: {
            message: "Hello World!",
          },
        },
      },
    ],
  },
  googleSheets: {
    key: "googleSheets",
    name: "Google Sheets",
    version: "1.0.0",
    platformVersion: "1",
    triggers: [
      {
        key: "newSpreadsheetRow",
        name: "New spreadsheet row",
        display: {
          label: "New spreadsheet row",
          description: "4",
          instructions: "",
        },
        operation: {
          type: "polling",
          operation: {
            url: "wss://grindery-gsheet-connector.herokuapp.com/ws/",
          },
          inputFields: [
            {
              key: "spreadsheet",
              label: "Spreadsheet",
              helpText: "",
              type: "string",
              required: true,
              placeholder: "Choose sheet...",
              choices: [
                {
                  value: "demo_sheet_1",
                  label: "Demo Sheet 1",
                  sample: "demo_sheet_1",
                },
                {
                  value: "demo_sheet_2",
                  label: "Demo Sheet 2",
                  sample: "demo_sheet_2",
                },
              ],
            },
            {
              key: "worksheet",
              label: "Worksheet",
              helpText: "You must have column headers",
              type: "string",
              required: true,
              placeholder: "Choose sheet...",
              choices: [
                {
                  value: "demo_worksheet_1",
                  label: "Demo Worksheet 1",
                  sample: "demo_worksheet_1",
                },
                {
                  value: "demo_worksheet_2",
                  label: "Demo Worksheet 2",
                  sample: "demo_worksheet_2",
                },
                {
                  value: "demo_worksheet_3",
                  label: "Demo Worksheet 3",
                  sample: "demo_worksheet_3",
                },
              ],
            },
          ],
          outputFields: [
            {
              key: "newRowColumns",
              type: "string",
              list: true,
            },
          ],
          sample: {
            newRowColumns: ["Column A data", "Column B data", "Column C data", "Column D data"],
          },
        },
      },
    ],
    authentication: {
      type: "oauth2",
      test: {
        method: "GET",
        url: "https://www.googleapis.com/oauth2/v3/userinfo",
      },
      oauth2Config: {
        authorizeUrl:
          "https://accounts.google.com/o/oauth2/v2/auth?prompt=consent&response_type=code&client_id=676778012745-q5lg8up8nq94qet4fjhs3ftvpgd4nalv.apps.googleusercontent.com&scope=https://www.googleapis.com/auth/spreadsheets+https://www.googleapis.com/auth/userinfo.email+https://www.googleapis.com/auth/spreadsheets.readonly+https://www.googleapis.com/auth/drive&access_type=offline",

        getAccessToken: {
          method: "POST",
          url: "https://oauth2.googleapis.com/token",
          body: {
            client_id: "676778012745-q5lg8up8nq94qet4fjhs3ftvpgd4nalv.apps.googleusercontent.com",
            client_secret: "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",
            grant_type: "authorization_code",
          },
        },
        refreshAccessToken: {
          method: "POST",
          url: "https://oauth2.googleapis.com/token",
          body: {
            client_id: "676778012745-q5lg8up8nq94qet4fjhs3ftvpgd4nalv.apps.googleusercontent.com",
            client_secret: "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",
            grant_type: "refresh_token",
          },
        },
      },
    },
  },
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
            url: "wss://gnexus-connector-web3.herokuapp.com/",
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
            url: "wss://gnexus-connector-web3.herokuapp.com/",
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
            url: "wss://gnexus-connector-web3.herokuapp.com/",
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
  molochOnXDai: {
    key: "molochOnXDai",
    name: "MolochDAO",
    version: "1.0.0",
    platformVersion: "1.0.0",
    triggers: [
      {
        key: "SummonCompleteTrigger",
        name: "Summon Complete",
        display: {
          label: "Summon Complete",
          description: "Summon Complete",
        },
        operation: {
          type: "blockchain:event",
          signature:
            "event SummonComplete(address indexed summoner, address[] tokens, uint256 summoningTime, uint256 periodDuration, uint256 votingPeriodLength, uint256 gracePeriodLength, uint256 proposalDeposit, uint256 dilutionBound, uint256 processingReward)",
          inputFields: [
            {
              key: "summoner",
              label: "Summoner",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "tokens",
              label: "Tokens",
              type: "string",
              placeholder: "",
              list: true,
            },
            {
              key: "summoningTime",
              label: "Summoning Time",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "periodDuration",
              label: "Period Duration",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "votingPeriodLength",
              label: "Voting Period Length",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "gracePeriodLength",
              label: "Grace Period Length",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalDeposit",
              label: "Proposal Deposit",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "dilutionBound",
              label: "Dilution Bound",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "processingReward",
              label: "Processing Reward",
              type: "string",
              placeholder: "",
              list: false,
            },
          ],
          outputFields: [
            {
              key: "summoner",
              label: "Summoner",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "tokens",
              label: "Tokens",
              type: "string",
              placeholder: "",
              list: true,
            },
            {
              key: "summoningTime",
              label: "Summoning Time",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "periodDuration",
              label: "Period Duration",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "votingPeriodLength",
              label: "Voting Period Length",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "gracePeriodLength",
              label: "Grace Period Length",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalDeposit",
              label: "Proposal Deposit",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "dilutionBound",
              label: "Dilution Bound",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "processingReward",
              label: "Processing Reward",
              type: "string",
              placeholder: "",
              list: false,
            },
          ],
          sample: {},
        },
      },
      {
        key: "SubmitProposalTrigger",
        name: "Submit Proposal",
        display: {
          label: "Submit Proposal",
          description: "Submit Proposal",
        },
        operation: {
          type: "blockchain:event",
          signature:
            "event SubmitProposal(address indexed applicant, uint256 sharesRequested, uint256 lootRequested, uint256 tributeOffered, address tributeToken, uint256 paymentRequested, address paymentToken, string details, bool[6] flags, uint256 proposalId, address indexed delegateKey, address indexed memberAddress)",
          inputFields: [
            {
              key: "applicant",
              label: "Applicant",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "sharesRequested",
              label: "Shares Requested",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "lootRequested",
              label: "Loot Requested",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "tributeOffered",
              label: "Tribute Offered",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "tributeToken",
              label: "Tribute Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "paymentRequested",
              label: "Payment Requested",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "paymentToken",
              label: "Payment Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "details",
              label: "Details",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "flags",
              label: "Flags",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "delegateKey",
              label: "Delegate Key",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
          ],
          outputFields: [
            {
              key: "applicant",
              label: "Applicant",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "sharesRequested",
              label: "Shares Requested",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "lootRequested",
              label: "Loot Requested",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "tributeOffered",
              label: "Tribute Offered",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "tributeToken",
              label: "Tribute Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "paymentRequested",
              label: "Payment Requested",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "paymentToken",
              label: "Payment Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "details",
              label: "Details",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "flags",
              label: "Flags",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "delegateKey",
              label: "Delegate Key",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
          ],
          sample: {},
        },
      },
      {
        key: "SponsorProposalTrigger",
        name: "Sponsor Proposal",
        display: {
          label: "Sponsor Proposal",
          description: "Sponsor Proposal",
        },
        operation: {
          type: "blockchain:event",
          signature:
            "event SponsorProposal(address indexed delegateKey, address indexed memberAddress, uint256 proposalId, uint256 proposalIndex, uint256 startingPeriod)",
          inputFields: [
            {
              key: "delegateKey",
              label: "Delegate Key",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "startingPeriod",
              label: "Starting Period",
              type: "string",
              placeholder: "",
              list: false,
            },
          ],
          outputFields: [
            {
              key: "delegateKey",
              label: "Delegate Key",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "startingPeriod",
              label: "Starting Period",
              type: "string",
              placeholder: "",
              list: false,
            },
          ],
          sample: {},
        },
      },
      {
        key: "SubmitVoteTrigger",
        name: "Submit Vote",
        display: {
          label: "Submit Vote",
          description: "Submit Vote",
        },
        operation: {
          type: "blockchain:event",
          signature:
            "event SubmitVote(uint256 proposalId, uint256 indexed proposalIndex, address indexed delegateKey, address indexed memberAddress, uint8 uintVote)",
          inputFields: [
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "delegateKey",
              label: "Delegate Key",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "uintVote",
              label: "Uint Vote",
              type: "number",
              placeholder: "",
              list: false,
            },
          ],
          outputFields: [
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "delegateKey",
              label: "Delegate Key",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "uintVote",
              label: "Uint Vote",
              type: "number",
              placeholder: "",
              list: false,
            },
          ],
          sample: {},
        },
      },
      {
        key: "ProcessProposalTrigger",
        name: "Process Proposal",
        display: {
          label: "Process Proposal",
          description: "Process Proposal",
        },
        operation: {
          type: "blockchain:event",
          signature: "event ProcessProposal(uint256 indexed proposalIndex, uint256 indexed proposalId, bool didPass)",
          inputFields: [
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "didPass",
              label: "Did Pass",
              type: "boolean",
              placeholder: "",
              list: false,
            },
          ],
          outputFields: [
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "didPass",
              label: "Did Pass",
              type: "boolean",
              placeholder: "",
              list: false,
            },
          ],
          sample: {},
        },
      },
      {
        key: "ProcessWhitelistProposalTrigger",
        name: "Process Whitelist Proposal",
        display: {
          label: "Process Whitelist Proposal",
          description: "Process Whitelist Proposal",
        },
        operation: {
          type: "blockchain:event",
          signature:
            "event ProcessWhitelistProposal(uint256 indexed proposalIndex, uint256 indexed proposalId, bool didPass)",
          inputFields: [
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "didPass",
              label: "Did Pass",
              type: "boolean",
              placeholder: "",
              list: false,
            },
          ],
          outputFields: [
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "didPass",
              label: "Did Pass",
              type: "boolean",
              placeholder: "",
              list: false,
            },
          ],
          sample: {},
        },
      },
      {
        key: "ProcessGuildKickProposalTrigger",
        name: "Process Guild Kick Proposal",
        display: {
          label: "Process Guild Kick Proposal",
          description: "Process Guild Kick Proposal",
        },
        operation: {
          type: "blockchain:event",
          signature:
            "event ProcessGuildKickProposal(uint256 indexed proposalIndex, uint256 indexed proposalId, bool didPass)",
          inputFields: [
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "didPass",
              label: "Did Pass",
              type: "boolean",
              placeholder: "",
              list: false,
            },
          ],
          outputFields: [
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "didPass",
              label: "Did Pass",
              type: "boolean",
              placeholder: "",
              list: false,
            },
          ],
          sample: {},
        },
      },
      {
        key: "RagequitTrigger",
        name: "Ragequit",
        display: {
          label: "Ragequit",
          description: "Ragequit",
        },
        operation: {
          type: "blockchain:event",
          signature: "event Ragequit(address indexed memberAddress, uint256 sharesToBurn, uint256 lootToBurn)",
          inputFields: [
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "sharesToBurn",
              label: "Shares To Burn",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "lootToBurn",
              label: "Loot To Burn",
              type: "string",
              placeholder: "",
              list: false,
            },
          ],
          outputFields: [
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "sharesToBurn",
              label: "Shares To Burn",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "lootToBurn",
              label: "Loot To Burn",
              type: "string",
              placeholder: "",
              list: false,
            },
          ],
          sample: {},
        },
      },
      {
        key: "TokensCollectedTrigger",
        name: "Tokens Collected",
        display: {
          label: "Tokens Collected",
          description: "Tokens Collected",
        },
        operation: {
          type: "blockchain:event",
          signature: "event TokensCollected(address indexed token, uint256 amountToCollect)",
          inputFields: [
            {
              key: "token",
              label: "Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "amountToCollect",
              label: "Amount To Collect",
              type: "string",
              placeholder: "",
              list: false,
            },
          ],
          outputFields: [
            {
              key: "token",
              label: "Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "amountToCollect",
              label: "Amount To Collect",
              type: "string",
              placeholder: "",
              list: false,
            },
          ],
          sample: {},
        },
      },
      {
        key: "CancelProposalTrigger",
        name: "Cancel Proposal",
        display: {
          label: "Cancel Proposal",
          description: "Cancel Proposal",
        },
        operation: {
          type: "blockchain:event",
          signature: "event CancelProposal(uint256 indexed proposalId, address applicantAddress)",
          inputFields: [
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "applicantAddress",
              label: "Applicant Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
          ],
          outputFields: [
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
            },
            {
              key: "applicantAddress",
              label: "Applicant Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
          ],
          sample: {},
        },
      },
      {
        key: "UpdateDelegateKeyTrigger",
        name: "Update Delegate Key",
        display: {
          label: "Update Delegate Key",
          description: "Update Delegate Key",
        },
        operation: {
          type: "blockchain:event",
          signature: "event UpdateDelegateKey(address indexed memberAddress, address newDelegateKey)",
          inputFields: [
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "newDelegateKey",
              label: "New Delegate Key",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
          ],
          outputFields: [
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "newDelegateKey",
              label: "New Delegate Key",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
          ],
          sample: {},
        },
      },
      {
        key: "WithdrawTrigger",
        name: "Withdraw",
        display: {
          label: "Withdraw",
          description: "Withdraw",
        },
        operation: {
          type: "blockchain:event",
          signature: "event Withdraw(address indexed memberAddress, address token, uint256 amount)",
          inputFields: [
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "token",
              label: "Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "amount",
              label: "Amount",
              type: "string",
              placeholder: "",
              list: false,
            },
          ],
          outputFields: [
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "token",
              label: "Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
            },
            {
              key: "amount",
              label: "Amount",
              type: "string",
              placeholder: "",
              list: false,
            },
          ],
          sample: {},
        },
      },
    ],
    actions: [
      {
        key: "proposalsAction",
        name: "Proposals (View function)",
        display: {
          label: "Proposals (View function)",
          description: "Proposals (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature:
            "function proposals(uint256 param0) view returns address, address, address, uint256, uint256, uint256, address, uint256, address, uint256, uint256, uint256, string, uint256",
          inputFields: [
            {
              key: "param0",
              label: "Param 0",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "processingRewardAction",
        name: "Processing Reward (View function)",
        display: {
          label: "Processing Reward (View function)",
          description: "Processing Reward (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function processingReward() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Processing Reward",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "getMemberProposalVoteAction",
        name: "Get Member Proposal Vote (View function)",
        display: {
          label: "Get Member Proposal Vote (View function)",
          description: "Get Member Proposal Vote (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function getMemberProposalVote(address memberAddress, uint256 proposalIndex) view returns uint8",
          inputFields: [
            {
              key: "memberAddress",
              label: "Member Address",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Get Member Proposal Vote",
              type: "number",
            },
          ],
          sample: {},
        },
      },
      {
        key: "getCurrentPeriodAction",
        name: "Get Current Period (View function)",
        display: {
          label: "Get Current Period (View function)",
          description: "Get Current Period (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function getCurrentPeriod() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Get Current Period",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "membersAction",
        name: "Members (View function)",
        display: {
          label: "Members (View function)",
          description: "Members (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function members(address param0) view returns address, uint256, uint256, bool, uint256, uint256",
          inputFields: [
            {
              key: "param0",
              label: "Param 0",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "withdrawBalanceAction",
        name: "Withdraw Balance",
        display: {
          label: "Withdraw Balance",
          description: "Withdraw Balance",
        },
        operation: {
          type: "blockchain:call",
          signature: "function withdrawBalance(address token, uint256 amount)",
          inputFields: [
            {
              key: "token",
              label: "Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
            {
              key: "amount",
              label: "Amount",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "submitGuildKickProposalAction",
        name: "Submit Guild Kick Proposal",
        display: {
          label: "Submit Guild Kick Proposal",
          description: "Submit Guild Kick Proposal",
        },
        operation: {
          type: "blockchain:call",
          signature: "function submitGuildKickProposal(address memberToKick, string details) returns uint256",
          inputFields: [
            {
              key: "memberToKick",
              label: "Member To Kick",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
            {
              key: "details",
              label: "Details",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "ragequitAction",
        name: "Ragequit",
        display: {
          label: "Ragequit",
          description: "Ragequit",
        },
        operation: {
          type: "blockchain:call",
          signature: "function ragequit(uint256 sharesToBurn, uint256 lootToBurn)",
          inputFields: [
            {
              key: "sharesToBurn",
              label: "Shares To Burn",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
            {
              key: "lootToBurn",
              label: "Loot To Burn",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "approvedTokensAction",
        name: "Approved Tokens (View function)",
        display: {
          label: "Approved Tokens (View function)",
          description: "Approved Tokens (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function approvedTokens(uint256 param0) view returns address",
          inputFields: [
            {
              key: "param0",
              label: "Param 0",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Approved Tokens",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "updateDelegateKeyAction",
        name: "Update Delegate Key",
        display: {
          label: "Update Delegate Key",
          description: "Update Delegate Key",
        },
        operation: {
          type: "blockchain:call",
          signature: "function updateDelegateKey(address newDelegateKey)",
          inputFields: [
            {
              key: "newDelegateKey",
              label: "New Delegate Key",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "TOTALAction",
        name: "TOTAL (View function)",
        display: {
          label: "TOTAL (View function)",
          description: "TOTAL (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function TOTAL() view returns address",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of TOTAL",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "processWhitelistProposalAction",
        name: "Process Whitelist Proposal",
        display: {
          label: "Process Whitelist Proposal",
          description: "Process Whitelist Proposal",
        },
        operation: {
          type: "blockchain:call",
          signature: "function processWhitelistProposal(uint256 proposalIndex)",
          inputFields: [
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "totalSharesAction",
        name: "Total Shares (View function)",
        display: {
          label: "Total Shares (View function)",
          description: "Total Shares (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function totalShares() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Total Shares",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "proposalQueueAction",
        name: "Proposal Queue (View function)",
        display: {
          label: "Proposal Queue (View function)",
          description: "Proposal Queue (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function proposalQueue(uint256 param0) view returns uint256",
          inputFields: [
            {
              key: "param0",
              label: "Param 0",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Proposal Queue",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "proposedToKickAction",
        name: "Proposed To Kick (View function)",
        display: {
          label: "Proposed To Kick (View function)",
          description: "Proposed To Kick (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function proposedToKick(address param0) view returns bool",
          inputFields: [
            {
              key: "param0",
              label: "Param 0",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Proposed To Kick",
              type: "boolean",
            },
          ],
          sample: {},
        },
      },
      {
        key: "memberAddressByDelegateKeyAction",
        name: "Member Address By Delegate Key (View function)",
        display: {
          label: "Member Address By Delegate Key (View function)",
          description: "Member Address By Delegate Key (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function memberAddressByDelegateKey(address param0) view returns address",
          inputFields: [
            {
              key: "param0",
              label: "Param 0",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Member Address By Delegate Key",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "withdrawBalancesAction",
        name: "Withdraw Balances",
        display: {
          label: "Withdraw Balances",
          description: "Withdraw Balances",
        },
        operation: {
          type: "blockchain:call",
          signature: "function withdrawBalances(address[] tokens, uint256[] amounts, bool max)",
          inputFields: [
            {
              key: "tokens",
              label: "Tokens",
              type: "string",
              placeholder: "",
              list: true,
              required: true,
            },
            {
              key: "amounts",
              label: "Amounts",
              type: "string",
              placeholder: "",
              list: true,
              required: true,
            },
            {
              key: "max",
              label: "Max",
              type: "boolean",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "userTokenBalancesAction",
        name: "User Token Balances (View function)",
        display: {
          label: "User Token Balances (View function)",
          description: "User Token Balances (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function userTokenBalances(address param0, address param1) view returns uint256",
          inputFields: [
            {
              key: "param0",
              label: "Param 0",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
            {
              key: "param1",
              label: "Param 1",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of User Token Balances",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "submitProposalAction",
        name: "Submit Proposal",
        display: {
          label: "Submit Proposal",
          description: "Submit Proposal",
        },
        operation: {
          type: "blockchain:call",
          signature:
            "function submitProposal(address applicant, uint256 sharesRequested, uint256 lootRequested, uint256 tributeOffered, address tributeToken, uint256 paymentRequested, address paymentToken, string details) returns uint256",
          inputFields: [
            {
              key: "applicant",
              label: "Applicant",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
            {
              key: "sharesRequested",
              label: "Shares Requested",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
            {
              key: "lootRequested",
              label: "Loot Requested",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
            {
              key: "tributeOffered",
              label: "Tribute Offered",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
            {
              key: "tributeToken",
              label: "Tribute Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
            {
              key: "paymentRequested",
              label: "Payment Requested",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
            {
              key: "paymentToken",
              label: "Payment Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
            {
              key: "details",
              label: "Details",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "collectTokensAction",
        name: "Collect Tokens",
        display: {
          label: "Collect Tokens",
          description: "Collect Tokens",
        },
        operation: {
          type: "blockchain:call",
          signature: "function collectTokens(address token)",
          inputFields: [
            {
              key: "token",
              label: "Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "totalLootAction",
        name: "Total Loot (View function)",
        display: {
          label: "Total Loot (View function)",
          description: "Total Loot (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function totalLoot() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Total Loot",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "gracePeriodLengthAction",
        name: "Grace Period Length (View function)",
        display: {
          label: "Grace Period Length (View function)",
          description: "Grace Period Length (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function gracePeriodLength() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Grace Period Length",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "getUserTokenBalanceAction",
        name: "Get User Token Balance (View function)",
        display: {
          label: "Get User Token Balance (View function)",
          description: "Get User Token Balance (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function getUserTokenBalance(address user, address token) view returns uint256",
          inputFields: [
            {
              key: "user",
              label: "User",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
            {
              key: "token",
              label: "Token",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Get User Token Balance",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "tokenWhitelistAction",
        name: "Token Whitelist (View function)",
        display: {
          label: "Token Whitelist (View function)",
          description: "Token Whitelist (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function tokenWhitelist(address param0) view returns bool",
          inputFields: [
            {
              key: "param0",
              label: "Param 0",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Token Whitelist",
              type: "boolean",
            },
          ],
          sample: {},
        },
      },
      {
        key: "getTokenCountAction",
        name: "Get Token Count (View function)",
        display: {
          label: "Get Token Count (View function)",
          description: "Get Token Count (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function getTokenCount() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Get Token Count",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "getProposalQueueLengthAction",
        name: "Get Proposal Queue Length (View function)",
        display: {
          label: "Get Proposal Queue Length (View function)",
          description: "Get Proposal Queue Length (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function getProposalQueueLength() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Get Proposal Queue Length",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "summoningTimeAction",
        name: "Summoning Time (View function)",
        display: {
          label: "Summoning Time (View function)",
          description: "Summoning Time (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function summoningTime() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Summoning Time",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "votingPeriodLengthAction",
        name: "Voting Period Length (View function)",
        display: {
          label: "Voting Period Length (View function)",
          description: "Voting Period Length (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function votingPeriodLength() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Voting Period Length",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "proposalDepositAction",
        name: "Proposal Deposit (View function)",
        display: {
          label: "Proposal Deposit (View function)",
          description: "Proposal Deposit (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function proposalDeposit() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Proposal Deposit",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "hasVotingPeriodExpiredAction",
        name: "Has Voting Period Expired (View function)",
        display: {
          label: "Has Voting Period Expired (View function)",
          description: "Has Voting Period Expired (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function hasVotingPeriodExpired(uint256 startingPeriod) view returns bool",
          inputFields: [
            {
              key: "startingPeriod",
              label: "Starting Period",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Has Voting Period Expired",
              type: "boolean",
            },
          ],
          sample: {},
        },
      },
      {
        key: "sponsorProposalAction",
        name: "Sponsor Proposal",
        display: {
          label: "Sponsor Proposal",
          description: "Sponsor Proposal",
        },
        operation: {
          type: "blockchain:call",
          signature: "function sponsorProposal(uint256 proposalId)",
          inputFields: [
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "submitVoteAction",
        name: "Submit Vote",
        display: {
          label: "Submit Vote",
          description: "Submit Vote",
        },
        operation: {
          type: "blockchain:call",
          signature: "function submitVote(uint256 proposalIndex, uint8 uintVote)",
          inputFields: [
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
            {
              key: "uintVote",
              label: "Uint Vote",
              type: "number",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "totalGuildBankTokensAction",
        name: "Total Guild Bank Tokens (View function)",
        display: {
          label: "Total Guild Bank Tokens (View function)",
          description: "Total Guild Bank Tokens (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function totalGuildBankTokens() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Total Guild Bank Tokens",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "canRagequitAction",
        name: "Can Ragequit (View function)",
        display: {
          label: "Can Ragequit (View function)",
          description: "Can Ragequit (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function canRagequit(uint256 highestIndexYesVote) view returns bool",
          inputFields: [
            {
              key: "highestIndexYesVote",
              label: "Highest Index Yes Vote",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Can Ragequit",
              type: "boolean",
            },
          ],
          sample: {},
        },
      },
      {
        key: "initAction",
        name: "Init",
        display: {
          label: "Init",
          description: "Init",
        },
        operation: {
          type: "blockchain:call",
          signature:
            "function init(address[] _summoner, address[] _approvedTokens, uint256 _periodDuration, uint256 _votingPeriodLength, uint256 _gracePeriodLength, uint256 _proposalDeposit, uint256 _dilutionBound, uint256 _processingReward, uint256[] _summonerShares)",
          inputFields: [
            {
              key: "_summoner",
              label: "Summoner",
              type: "string",
              placeholder: "",
              list: true,
              required: true,
            },
            {
              key: "_approvedTokens",
              label: "Approved Tokens",
              type: "string",
              placeholder: "",
              list: true,
              required: true,
            },
            {
              key: "_periodDuration",
              label: "Period Duration",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
            {
              key: "_votingPeriodLength",
              label: "Voting Period Length",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
            {
              key: "_gracePeriodLength",
              label: "Grace Period Length",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
            {
              key: "_proposalDeposit",
              label: "Proposal Deposit",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
            {
              key: "_dilutionBound",
              label: "Dilution Bound",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
            {
              key: "_processingReward",
              label: "Processing Reward",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
            {
              key: "_summonerShares",
              label: "Summoner Shares",
              type: "string",
              placeholder: "",
              list: true,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "dilutionBoundAction",
        name: "Dilution Bound (View function)",
        display: {
          label: "Dilution Bound (View function)",
          description: "Dilution Bound (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function dilutionBound() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Dilution Bound",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "getProposalFlagsAction",
        name: "Get Proposal Flags (View function)",
        display: {
          label: "Get Proposal Flags (View function)",
          description: "Get Proposal Flags (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function getProposalFlags(uint256 proposalId) view returns bool[6]",
          inputFields: [
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Get Proposal Flags",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "memberListAction",
        name: "Member List (View function)",
        display: {
          label: "Member List (View function)",
          description: "Member List (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function memberList(uint256 param0) view returns address",
          inputFields: [
            {
              key: "param0",
              label: "Param 0",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Member List",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "periodDurationAction",
        name: "Period Duration (View function)",
        display: {
          label: "Period Duration (View function)",
          description: "Period Duration (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function periodDuration() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Period Duration",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "depositTokenAction",
        name: "Deposit Token (View function)",
        display: {
          label: "Deposit Token (View function)",
          description: "Deposit Token (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function depositToken() view returns address",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Deposit Token",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "proposalCountAction",
        name: "Proposal Count (View function)",
        display: {
          label: "Proposal Count (View function)",
          description: "Proposal Count (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function proposalCount() view returns uint256",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Proposal Count",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "ragekickAction",
        name: "Ragekick",
        display: {
          label: "Ragekick",
          description: "Ragekick",
        },
        operation: {
          type: "blockchain:call",
          signature: "function ragekick(address memberToKick)",
          inputFields: [
            {
              key: "memberToKick",
              label: "Member To Kick",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "cancelProposalAction",
        name: "Cancel Proposal",
        display: {
          label: "Cancel Proposal",
          description: "Cancel Proposal",
        },
        operation: {
          type: "blockchain:call",
          signature: "function cancelProposal(uint256 proposalId)",
          inputFields: [
            {
              key: "proposalId",
              label: "Proposal Id",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "proposedToWhitelistAction",
        name: "Proposed To Whitelist (View function)",
        display: {
          label: "Proposed To Whitelist (View function)",
          description: "Proposed To Whitelist (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function proposedToWhitelist(address param0) view returns bool",
          inputFields: [
            {
              key: "param0",
              label: "Param 0",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
          ],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of Proposed To Whitelist",
              type: "boolean",
            },
          ],
          sample: {},
        },
      },
      {
        key: "processGuildKickProposalAction",
        name: "Process Guild Kick Proposal",
        display: {
          label: "Process Guild Kick Proposal",
          description: "Process Guild Kick Proposal",
        },
        operation: {
          type: "blockchain:call",
          signature: "function processGuildKickProposal(uint256 proposalIndex)",
          inputFields: [
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "processProposalAction",
        name: "Process Proposal",
        display: {
          label: "Process Proposal",
          description: "Process Proposal",
        },
        operation: {
          type: "blockchain:call",
          signature: "function processProposal(uint256 proposalIndex)",
          inputFields: [
            {
              key: "proposalIndex",
              label: "Proposal Index",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
            },
          ],
          outputFields: [],
          sample: {},
        },
      },
      {
        key: "ESCROWAction",
        name: "ESCROW (View function)",
        display: {
          label: "ESCROW (View function)",
          description: "ESCROW (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function ESCROW() view returns address",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of ESCROW",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "GUILDAction",
        name: "GUILD (View function)",
        display: {
          label: "GUILD (View function)",
          description: "GUILD (View function)",
        },
        operation: {
          type: "blockchain:call",
          signature: "function GUILD() view returns address",
          inputFields: [],
          outputFields: [
            {
              key: "returnValue",
              label: "Return value of GUILD",
              type: "string",
            },
          ],
          sample: {},
        },
      },
      {
        key: "submitWhitelistProposalAction",
        name: "Submit Whitelist Proposal",
        display: {
          label: "Submit Whitelist Proposal",
          description: "Submit Whitelist Proposal",
        },
        operation: {
          type: "blockchain:call",
          signature: "function submitWhitelistProposal(address tokenToWhitelist, string details) returns uint256",
          inputFields: [
            {
              key: "tokenToWhitelist",
              label: "Token To Whitelist",
              type: "string",
              placeholder: "Enter a blockchain address",
              list: false,
              required: true,
            },
            {
              key: "details",
              label: "Details",
              type: "string",
              placeholder: "",
              list: false,
              required: true,
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

async function runAction({
  action,
  input,
  step,
  sessionId,
  executionId,
}: {
  action: ActionSchema;
  input: unknown;
  step: OperationSchema;
  sessionId: string;
  executionId: string;
}) {
  let actionOp = action.operation;
  if (actionOp.type === "blockchain:call") {
    const web3Connector = await getConnectorSchema("web3");
    if (!web3Connector) {
      throw new Error("Web3 connector not found");
    }
    const web3Action = web3Connector.actions?.find((a) => a.key === "callSmartContract");
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
        key: step.operation,
        sessionId,
        executionId,
        credentials: step.credentials,
        fields: input,
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
export async function runSingleAction({ step, input }: { step: OperationSchema; input: unknown }) {
  const connector = await getConnectorSchema(step.connector);
  const action = connector.actions?.find((action) => action.key === step.operation);
  if (!action) {
    throw new Error("Invalid action");
  }
  return await runAction({
    action,
    input,
    step,
    sessionId: uuidv4(),
    executionId: uuidv4(),
  });
}
export class RuntimeWorkflow {
  private running = false;
  private triggerSocket: JsonRpcWebSocket | null = null;

  constructor(private key: string, private workflow: WorkflowSchema) {}
  async start() {
    this.running = true;
    await this.setupTrigger();
  }
  stop() {
    this.running = false;
    this.triggerSocket?.close();
    console.debug(`[${this.key}] Stopped`);
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
      this.triggerSocket = new JsonRpcWebSocket(url);
      this.triggerSocket.addMethod("notifySignal", this.onNotifySignal.bind(this));
      await this.triggerSocket.request<ConnectorInput>("setupSignal", {
        key: trigger.key,
        sessionId,
        credentials: this.workflow.trigger.credentials,
        fields,
      });
      console.debug(
        `[${this.key}] Started trigger ${this.workflow.trigger.connector}/${this.workflow.trigger.operation}`
      );
      this.keepAlive();
    } else {
      throw new Error(`Invalid trigger type: ${trigger.operation.type}`);
    }
  }
}
