import { getDB, withTransaction } from "../data/db";
import { getParam } from "../data/param";
import * as srs from "secure-random-string";
import { PoolClient } from "pg";

interface QueuePayload {
  [key: string]: string | number | boolean | null | undefined | any;
}

// Priority levels for work queue items (must match Go constants in pkg/persistence/queue.go)
// 0 (or NULL) = normal priority, 1 = high priority
export const PRIORITY_NORMAL = 0
export const PRIORITY_HIGH = 1

// Syft downloads time out after 30 minutes. The extra minute lets the status
// poller record that timeout before a later submission recovers an orphaned
// generation. Keep this aligned with pkg/externalimage/sbom_queue.go.
const EXTERNAL_IMAGE_SBOM_GENERATING_STALE_AFTER_MS = 31 * 60 * 1000;

export async function enqueueWork(channel: string, payload: QueuePayload, client?: PoolClient): Promise<string> {
  return enqueueWorkWithPriority(channel, payload, PRIORITY_NORMAL, client)
}

export async function enqueueWorkWithPriority(channel: string, payload: QueuePayload, priority: number, client?: PoolClient): Promise<string> {
  const db = client ?? getDB(await getParam("DB_URI"));

  const id = srs.default({ length: 12, alphanumeric: true });
  const now = new Date();

  await db.query(
    `INSERT INTO work_queue (id, channel, payload, created_at, priority) ` +
    `VALUES ($1, $2, $3, $4, $5)`,
    [id, channel, payload, now, priority]
  );

  await db.query(`SELECT pg_notify('${channel}', $1)`, [id]);

  return id;
}

/**
 * Enqueues work only when no unfinished item with the same channel and
 * deduplication key exists. Returns null when the existing item wins.
 */
export async function enqueueUniqueWork(
  channel: string,
  payload: QueuePayload,
  dedupeKey: string,
  client?: PoolClient,
): Promise<string | null> {
  const db = client ?? getDB(await getParam("DB_URI"));

  const id = srs.default({ length: 12, alphanumeric: true });
  const now = new Date();

  const result = await db.query(
    `INSERT INTO work_queue (id, channel, payload, dedupe_key, created_at, priority) ` +
    `VALUES ($1, $2, $3, $4, $5, $6) ` +
    `ON CONFLICT (channel, dedupe_key) DO NOTHING ` +
    `RETURNING id`,
    [id, channel, payload, dedupeKey, now, PRIORITY_NORMAL],
  );

  if (result.rowCount === 0) {
    return null;
  }

  await db.query(`SELECT pg_notify($1, $2)`, [channel, id]);
  return id;
}

/**
 * Atomically creates pending external-image SBOM work unless the digest is
 * already queued, actively generating, or stored. A failed or stale digest can
 * be submitted again after its previous queue item is no longer active.
 */
export async function enqueueExternalImageSBOMWork(
  payload: QueuePayload,
  digest: string,
): Promise<string | null> {
  const db = getDB(await getParam("DB_URI"));

  return withTransaction(db, async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`external_image_sbom:${digest}`],
    );

    const generatingCutoff = new Date(
      Date.now() - EXTERNAL_IMAGE_SBOM_GENERATING_STALE_AFTER_MS,
    );
    const existing = await client.query(
      `SELECT
         EXISTS (
           SELECT 1
           FROM work_queue
           WHERE channel = 'external_image_sbom'
             AND completed_at IS NULL
             AND (dedupe_key = $1 OR payload->>'digest' = $1)
         )
         OR EXISTS (
           SELECT 1
           FROM external_image_sbom_status
           WHERE digest = $1
             AND status = 'generating'
             AND COALESCE(status_updated_at, updated_at, created_at) > $2
         )
         OR EXISTS (
           SELECT 1
           FROM external_image_sbom
           WHERE digest = $1
         ) AS blocked`,
      [digest, generatingCutoff],
    );
    if (existing.rows[0]?.blocked === true) {
      return null;
    }

    const id = await enqueueUniqueWork('external_image_sbom', payload, digest, client);
    if (id === null) {
      return null;
    }

    const now = new Date();
    await client.query(
      `INSERT INTO external_image_sbom_status
         (digest, created_at, status, status_message, updated_at, status_updated_at)
       VALUES ($1, $2, 'pending', NULL, $2, $2)
       ON CONFLICT (digest) DO UPDATE
       SET status = EXCLUDED.status,
           status_message = NULL,
           updated_at = EXCLUDED.updated_at,
           status_updated_at = EXCLUDED.status_updated_at`,
      [digest, now],
    );

    return id;
  });
}

export interface WorkStatus {
  id: string;
  status: string;
  channel: string;
  created_at: Date;
  processing_started_at: Date | null;
  completed_at: Date | null;
  last_error: string | null;
  attempt_count: number;
  result: any;
}

export async function getWorkStatus(workId: string): Promise<WorkStatus | null> {
  const client = getDB(await getParam("DB_URI"));

  const result = await client.query(
    `SELECT id, channel, payload, created_at, processing_started_at, completed_at, last_error, COALESCE(attempt_count, 0)::int as attempt_count, result FROM work_queue WHERE id = $1`,
    [workId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  let status: string;
  if (row.completed_at !== null && row.last_error !== null) {
    status = 'failed';
  } else if (row.completed_at !== null) {
    status = 'completed';
  } else if (row.processing_started_at !== null) {
    status = 'processing';
  } else {
    status = 'queued';
  }

  return {
    id: row.id,
    status,
    channel: row.channel,
    created_at: row.created_at,
    processing_started_at: row.processing_started_at,
    completed_at: row.completed_at,
    last_error: row.last_error,
    attempt_count: row.attempt_count,
    result: row.result,
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
