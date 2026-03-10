import { getDB } from "../data/db";
import { getParam } from "../data/param";
import * as srs from "secure-random-string";

interface QueuePayload {
  [key: string]: string | number | boolean | null | undefined | any;
}

// Priority levels for work queue items (must match Go constants in pkg/persistence/queue.go)
// 0 (or NULL) = normal priority, 1 = high priority
export const PRIORITY_NORMAL = 0
export const PRIORITY_HIGH = 1

export async function enqueueWork(channel: string, payload: QueuePayload): Promise<string> {
  return enqueueWorkWithPriority(channel, payload, PRIORITY_NORMAL)
}

export async function enqueueWorkWithPriority(channel: string, payload: QueuePayload, priority: number): Promise<string> {
  const client = getDB(await getParam("DB_URI"));

  const id = srs.default({ length: 12, alphanumeric: true });
  const now = new Date();

  await client.query(
    `INSERT INTO work_queue (id, channel, payload, created_at, priority) ` +
    `VALUES ($1, $2, $3, $4, $5)`,
    [id, channel, payload, now, priority]
  );

  await client.query(`SELECT pg_notify('${channel}', $1)`, [id]);

  return id;
}

export async function getWorkStatus(workId: string): Promise<{
  id: string;
  status: string;
  created_at: Date;
  updated_at?: Date;
  error?: string;
  metadata?: any;
} | null> {
  const client = getDB(await getParam("DB_URI"));

  const result = await client.query(
    `SELECT id, channel as status, payload as metadata, created_at FROM work_queue WHERE id = $1`,
    [workId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    status: 'queued', // For now, all work queue items are considered queued
    created_at: row.created_at,
    metadata: row.metadata
  };
}

/**
 * Checks if an SBOM already exists for this digest.
 * Used to prevent duplicate enqueuing - checked both before enqueuing and after receiving.
 */
export async function hasExistingSBOM(digest: string): Promise<boolean> {
  try {
    const db = getDB(await getParam("DB_URI"))

    const query = `
      SELECT EXISTS(
        SELECT 1 FROM external_image_sbom
        WHERE digest = $1
      ) as exists
    `
    const result = await db.query(query, [digest])
    return result.rows[0]?.exists === true
  } catch (err) {
    console.error(`hasExistingSBOM error:`, err)
    // On error, return false to allow work to be enqueued (better to duplicate than miss)
    return false
  }
}
