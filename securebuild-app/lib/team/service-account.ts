import srs from "secure-random-string";
import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { generateServiceAccountToken, ALGORITHM_SHA256 } from "./token";

export interface SystemServiceAccount {
  id: string;
  name: string;
  partialValue: string;
  expiresAt: Date | null;
  expiresIn: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface SystemServiceAccountWithValue extends SystemServiceAccount {
  value: string;
}

export async function createSystemAccount(name: string, expiresIn: string): Promise<SystemServiceAccountWithValue> {
  const db = getDB(await getParam("DB_URI"));

  const { token, hash, partialValue } = generateServiceAccountToken();

  const id = srs({ length: 12, alphanumeric: true });
  const expiresAt = expiresIn === 'never' ? null : new Date(Date.now() + parseInt(expiresIn) * 24 * 60 * 60 * 1000);
  const createdAt = new Date();

  const result = await db.query(
    `
      INSERT INTO service_account (id, name, partial_value, expires_at, expires_in, last_used_at, created_at, team_id, bcrypt_hash, hash_algorithm, is_system)
      VALUES ($1, $2, $3, $4, $5, null, $6, NULL, $7, $8, true)
      RETURNING id, name, partial_value, expires_at, expires_in, last_used_at, created_at
    `,
    [id, name, partialValue, expiresAt, expiresIn, createdAt, hash, ALGORITHM_SHA256]
  );

  return {
    id: result.rows[0].id,
    name: result.rows[0].name,
    partialValue: result.rows[0].partial_value,
    expiresAt: result.rows[0].expires_at,
    expiresIn: result.rows[0].expires_in,
    lastUsedAt: result.rows[0].last_used_at,
    createdAt: result.rows[0].created_at,
    value: token,
  };
}

export async function listSystemAccounts(): Promise<SystemServiceAccount[]> {
  const db = getDB(await getParam("DB_URI"));

  const query = `select id, name, partial_value, expires_at, expires_in, last_used_at, created_at from service_account where is_system = true`
  const result = await db.query(query);

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    partialValue: row.partial_value,
    expiresAt: row.expires_at,
    expiresIn: row.expires_in,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  }));
}

export async function getSystemAccount(id: string): Promise<SystemServiceAccount | null> {
  const db = getDB(await getParam("DB_URI"));

  const query = `select id, name, partial_value, expires_at, expires_in, last_used_at, created_at from service_account where id = $1 and is_system = true`
  const result = await db.query(query, [id]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    partialValue: row.partial_value,
    expiresAt: row.expires_at,
    expiresIn: row.expires_in,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

export async function deleteSystemAccount(id: string): Promise<void> {
  const db = getDB(await getParam("DB_URI"));
  await db.query(`delete from service_account where id = $1 and is_system = true`, [id]);
}
