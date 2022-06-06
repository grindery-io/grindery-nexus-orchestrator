import { Collection, MongoClient } from "mongodb";

let cachedClient: MongoClient | Promise<MongoClient> | null = null;

type DbSchema = {
  workflows: {
    key: string;
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
};

async function getDb() {
  if (cachedClient) {
    return (await cachedClient).db();
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  cachedClient = MongoClient.connect(process.env.MONGODB_URI!);
  cachedClient = await cachedClient;
  return cachedClient.db();
}
export async function getCollection<T extends keyof DbSchema>(collectionName: T): Promise<Collection<DbSchema[T]>> {
  const db = await getDb();
  return db.collection(collectionName);
}
