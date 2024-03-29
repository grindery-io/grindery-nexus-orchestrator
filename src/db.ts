import { Collection, CreateIndexesOptions, Db, IndexSpecification, MongoClient } from "mongodb";

let cachedClient: MongoClient | Promise<MongoClient> | null = null;

export type DbSchema = {
  workflows: {
    key: string;
    workspaceKey?: string;
    userAccountId: string;
    workflow: string; // JSON string
    enabled: boolean;
    updatedAt: number; // milliseconds since epoch
    createdAt: number; // milliseconds since epoch
  };
  workflowExecutions: {
    workflowKey: string;
    sessionId: string;
    executionId: string;
    stepIndex: number;
    input: unknown;
    output?: unknown;
    error?: unknown;
    startedAt: number; // milliseconds since epoch
    endedAt?: number; // milliseconds since epoch
  };
  workflowStates: {
    workflowKey: string;
    stepIndex: number;
    stateKey: string;
    value: string; // JSON
    updatedAt: number; // milliseconds since epoch
    createdAt: number; // milliseconds since epoch
  };
  workspaces: {
    key: string;
    title: string;
    iconUrl?: string;
    about?: string;
    creator: string;
    admins: string[];
    users: string[];
    updatedAt: number; // milliseconds since epoch
    createdAt: number; // milliseconds since epoch
  };
};

const INDEXES: { [name in keyof DbSchema]: [IndexSpecification, CreateIndexesOptions][] } = {
  workflows: [
    [{ key: 1 }, { unique: true }],
    [{ userAccountId: 1 }, {}],
    [{ userAccountId: 1, key: 1 }, { unique: true }],
    [{ workspaceKey: 1 }, {}],
  ],
  workflowExecutions: [
    [{ workflowKey: 1 }, {}],
    [{ executionId: 1 }, {}],
  ],
  workflowStates: [
    [{ workflowKey: 1 }, {}],
    [{ workflowKey: 1, stepIndex: 1, stateKey: 1 }, { unique: true }],
  ],
  workspaces: [
    [{ key: 1 }, { unique: true }],
    [{ admins: 1 }, {}],
    [{ users: 1 }, {}],
  ],
};

async function createIndexes(db: Db) {
  for (const collectionName of Object.keys(INDEXES)) {
    const collection = db.collection(collectionName);
    for (const [spec, options] of INDEXES[collectionName]) {
      await collection.createIndex(spec, options);
    }
  }
}

async function getDb() {
  if (cachedClient) {
    return (await cachedClient).db();
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set");
    process.exit(1);
  }
  cachedClient = MongoClient.connect(uri);
  cachedClient = await cachedClient;
  await createIndexes(cachedClient.db());
  return cachedClient.db();
}
getDb().catch((e) => {
  console.error("Failed to connect to database:", e);
  process.exit(1);
});
export async function getCollection<T extends keyof DbSchema>(collectionName: T): Promise<Collection<DbSchema[T]>> {
  const db = await getDb();
  return db.collection(collectionName);
}
