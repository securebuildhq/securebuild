"use server";

import { User } from "@/lib/types/user";
import * as srs from "secure-random-string";
import jwt from "jsonwebtoken";
import { getDB, withTransaction } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";
import parse from "parse-duration";
import { logger } from "@/lib/utils/logger";
import { Session } from "@/lib/types/session";
import { getUser } from "./user";
import { getTeam, listUserTeams } from "../team/team";

const sessionDuration = "72h";

export async function createSession(user: User): Promise<Session> {
  try {
    const id = srs.default({ length: 12, alphanumeric: true });
    const db = getDB(await getParam("DB_URI"));

    const teams = await listUserTeams(user.id);

    await db.query(
      `
            INSERT INTO securebuild_session (id, user_id, expires_at, god_mode_teams, selected_team_id)
            VALUES ($1, $2, now() + interval '24 hours', '[]', $3)
        `,
      [id, user.id, teams[0].id],
    );

    return {
      id,
      user,
      teams,
      godModeTeams: [],
      selectedTeamId: teams[0].id,
      expiresAt: new Date(Date.now() + parse(sessionDuration, "ms")!),
    };
  } catch (err) {
    logger.error("Failed to create session", { err });
    throw err;
  }
}

export async function sessionToken(session: Session): Promise<string> {
  const options: jwt.SignOptions = {
    expiresIn: sessionDuration,
    subject: session.user.id,
  };

  // Generate the JWT using the payload, secret, and options
  const payload: any = {
    id: session.id,
    firstName: session.user.firstName,
    lastName: session.user.lastName,
    email: session.user.email,
    picture: session.user.picture,
    userId: session.user.id,
    teams: session.teams.map((team) => ({
      id: team.id,
      name: team.name,
    })),
    selectedTeamId: session.selectedTeamId,
  }

  if (session.godModeTeams.length > 0) {
    payload.godModeTeams = session.godModeTeams.map((team) => ({
      id: team.id,
      name: team.name,
    }));
  }

  const token = jwt.sign(
    payload,
    process.env.HMAC_SECRET!,
    options,
  );

  return token;
}

export async function extendSession(session: Session): Promise<Session> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await db.query(
      `UPDATE securebuild_session SET expires_at = now() + interval '24 hours' WHERE id = $1`,
      [session.id],
    );

    return {
      ...session,
      expiresAt: new Date(Date.now() + parse(sessionDuration, "ms")!),
    };
  } catch (err) {
    logger.error("Failed to extend session", { err });
    throw err;
  }
}

export async function setSelectedTeamInSession(sessionId: string, teamId: string): Promise<Session> {
  try {
    const db = getDB(await getParam("DB_URI"));

    await db.query(
      `UPDATE securebuild_session SET selected_team_id = $1 WHERE id = $2`,
      [teamId, sessionId],
    );

    const session = await findSession(undefined, sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    return session;
  } catch (err) {
    logger.error("Failed to set selected team in session", { err });
    throw err;
  }
}

export async function removeGodModeTeamFromSession(sessionId: string, teamId: string): Promise<Session> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await withTransaction(db, async (tx) => {
      const result = await tx.query(`select user_id, god_mode_teams from securebuild_session where id = $1`, [sessionId]);
      const godModeTeams = result.rows[0].god_mode_teams;
      if (godModeTeams.includes(teamId)) {
        godModeTeams.splice(godModeTeams.indexOf(teamId), 1);
      }

      const teams = await listUserTeams(result.rows[0].user_id);
      const selectedTeamId = teams[0].id;

      await tx.query(
        `UPDATE securebuild_session SET god_mode_teams = $1, selected_team_id = $2 WHERE id = $3`,
        [JSON.stringify(godModeTeams), selectedTeamId, sessionId],
      );
    });

    const session = await findSession(undefined, sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    return session;
  } catch (err) {
    logger.error("Failed to remove god mode team from session", { err });
    throw err;
  }
}

export async function addGodModeTeamToSession(sessionId: string, teamId: string): Promise<Session> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await withTransaction(db, async (tx) => {
      const result = await tx.query(`select god_mode_teams from securebuild_session where id = $1`, [sessionId]);
      const godModeTeams = result.rows[0].god_mode_teams;
      if (!godModeTeams.includes(teamId)) {
        godModeTeams.push(teamId);
        await tx.query(
          `UPDATE securebuild_session SET god_mode_teams = $1, selected_team_id = $2 WHERE id = $3`,
          [JSON.stringify(godModeTeams), teamId, sessionId],
        );
      }
    });

    const session = await findSession(undefined, sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    return session;
  } catch (err) {
    logger.error("Failed to add god mode team to session", { err });
    throw err;
  }
}

export async function findSession(token: string | undefined, id: string | undefined): Promise<Session | undefined> {
  try {
    let sessionId: string = ""

    if (token) {
      const decoded = jwt.verify(token, process.env.HMAC_SECRET!) as { id: string };
      sessionId = decoded.id;
    } else if (id) {
      sessionId = id;
    }

    if (!sessionId) {
      return;
    }

    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(
      `
            SELECT
                securebuild_session.id,
                securebuild_session.user_id,
                securebuild_session.expires_at,
                securebuild_session.selected_team_id,
                securebuild_session.god_mode_teams,
                securebuild_user.picture
            FROM
                securebuild_session
                JOIN securebuild_user ON securebuild_user.id = securebuild_session.user_id
            WHERE
                securebuild_session.id = $1
        `,
      [sessionId],
    );

    if (result.rows.length === 0) {
      return;
    }

    const row = result.rows[0];
    const user = await getUser(row.user_id);
    if (!user) {
      return;
    }

    const teams = await listUserTeams(user.id);

    const godModeTeams = await Promise.all(row.god_mode_teams.map((teamId: string) => getTeam(teamId)));
    return {
      id: row.id,
      user,
      teams,
      godModeTeams,
      selectedTeamId: row.selected_team_id || teams[0].id,
      expiresAt: row.expires_at,
    };
  } catch (err: unknown) {
    // if the error contains "jwt expired" just return undefined
    if (err instanceof Error && err.message.includes("jwt expired")) {
      return;
    }

    logger.error("Failed to find session", { err });
    throw err;
  }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await db.query(
      `
            DELETE FROM securebuild_session
            WHERE
                securebuild_session.id = $1
        `,
      [id],
    );
  } catch (err) {
    logger.error("Failed to delete session", { err });
    throw err;
  }
}

