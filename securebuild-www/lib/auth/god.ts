import { getTeam } from "../team/team";
import { getDB, withTransaction } from "../data/db";
import { getParam } from "../data/param";
import { Team } from "@/lib/types/team";


export async function getGodModeTeam(nonce: string): Promise<Team> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const expiresAt = new Date().toISOString();

    const result = await db.query(`select subject_team_id from god_mode_nonce where nonce = $1 and used_at is null and expires_at > $2`, [nonce, expiresAt]);
    if (result.rows.length === 0) {
      throw new Error("Invalid nonce");
    }
    const teamId = result.rows[0].subject_team_id;
    const team = await getTeam(teamId);
    return team;
  } catch (err) {
    console.error("Error getting god mode team:", err);
    throw err;
  }
}

export async function consumeGodModeNonce(nonce: string): Promise<Team> {
  try {
    const db = getDB(await getParam("DB_URI"));
    let team: Team | null = null;
    await withTransaction(db, async (tx) => {
      const expiresAt = new Date().toISOString();
      const result = await tx.query(`select subject_team_id from god_mode_nonce where nonce = $1 and used_at is null and expires_at > $2`, [nonce, expiresAt]);
      team = await getTeam(result.rows[0].subject_team_id);
      if (!team) {
        throw new Error("Team not found");
      }

      await tx.query(`update god_mode_nonce set used_at = now() where nonce = $1 and used_at is null and expires_at > $2`, [nonce, expiresAt]);
    })
    if (!team) {
      throw new Error("Team not found");
    }
    return team;
  } catch (err) {
    console.error("Error consuming god mode nonce:", err);
    throw err;
  }
}