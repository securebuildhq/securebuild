import { getDB } from "../data/db";
import { getParam } from "../data/param";
import * as srs from "secure-random-string";

interface QueuePayload {
  [key: string]: string | number | boolean | null | undefined | any;
}

export async function enqueueWork(channel: string, payload: QueuePayload): Promise<void> {
  const client = getDB(await getParam("DB_URI"));

  const id = srs.default({ length: 12, alphanumeric: true });
  const now = new Date();
  
  await client.query(
    `INSERT INTO work_queue (id, channel, payload, created_at) ` +
    `VALUES ($1, $2, $3, $4)`,
    [id, channel, payload, now]
  );

  await client.query(`SELECT pg_notify('${channel}', $1)`, [id]);
}

export async function notifyToolUseResponse(toolUseId: string) {
  const client = getDB(await getParam("DB_URI"));

  await client.query(`SELECT pg_notify('tooluse_${toolUseId}', '')`, []);
}
