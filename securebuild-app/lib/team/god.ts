import * as srs from "secure-random-string";
import { getParam } from "../data/param";
import { getDB } from "../data/db";


export async function createGodModeNonce(teamId: string, requestUserId: string): Promise<string> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const nonce = srs.default({ length: 36, alphanumeric: true });

    // expire these in 5 minutes
    const expiresAt = new Date(Date.now() + 1000 * 60 * 5).toUTCString();

    await db.query(`insert into god_mode_nonce (nonce, created_at, expires_at, requested_by_user_id, subject_team_id) values ($1, $2, $3, $4, $5)`, [nonce, new Date(), expiresAt, requestUserId, teamId]);
    return nonce;
  } catch (err) {
    console.error("Error creating god mode nonce:", err);
    throw err;
  }
}