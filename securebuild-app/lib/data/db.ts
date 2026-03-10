import { Pool, PoolConfig } from "pg";
import { parse } from "url";
import { parse as parseQueryString } from "querystring";
import { PoolClient } from "pg";

// Production mode: single pool (singleton)
let pool: Pool | null = null;
let readOnlyPool: Pool | null = null;

// Test mode: map of URI -> Pool for test isolation
const testPools: Map<string, Pool> = new Map();

export function getDB(uri: string): Pool {
  // Detect test mode by checking for Jest environment
  const isTestMode = process.env.NODE_ENV === 'test';

  // Test mode: use separate pools per URI for test isolation
  if (isTestMode) {
    if (testPools.has(uri)) {
      return testPools.get(uri)!;
    }

    const newPool = createPool(uri);
    testPools.set(uri, newPool);
    return newPool;
  }

  // Production mode: use singleton pool
  if (pool) {
    return pool;
  }

  pool = createPool(uri);
  return pool;
}

function createPool(uri: string): Pool {
  const params = parse(uri);
  const auth = params.auth?.split(":") || [];

  let ssl: boolean | { rejectUnauthorized: boolean } = {
    rejectUnauthorized: false,
  };
  const parsedQuery = parseQueryString(params.query || "");
  if (parsedQuery.sslmode === "disable") {
    ssl = false;
  }

  const config: PoolConfig = {
    user: auth[0],
    password: auth[1],
    host: params.hostname || "",
    port: parseInt(params.port || "5432"),
    database: params.pathname?.split("/")[1] || "",
    ssl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };

  return new Pool(config);
}

/**
 * Closes a specific pool by URI (test mode only).
 * In production, pools remain open for the lifetime of the server.
 */
export async function closePoolByUri(uri: string): Promise<void> {
  const isTestMode = process.env.NODE_ENV === 'test';
  if (isTestMode && testPools.has(uri)) {
    const pool = testPools.get(uri)!;
    await pool.end();
    testPools.delete(uri);
  }
}

export async function withClient<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
