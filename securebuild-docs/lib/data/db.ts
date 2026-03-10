import { Pool, PoolConfig } from "pg";
import { parse } from "url";
import { parse as parseQueryString } from "querystring";
import { PoolClient } from "pg";

let pool: Pool | null = null;

export function getDB(uri: string): Pool {
  if (pool) {
    return pool;
  }

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

  pool = new Pool(config);

  return pool;
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
