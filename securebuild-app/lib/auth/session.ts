"use server";

import { User } from "@/lib/types/user";
import * as srs from "secure-random-string";
import jwt from "jsonwebtoken";
import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";
import parse from "parse-duration";
import { getUser } from "@/lib/auth/user";
import { logger } from "@/lib/utils/logger";
import { Session } from "@/lib/types/session";

const sessionDuration = "72h";

export async function createSession(user: User): Promise<Session> {
  try {
    const id = srs.default({ length: 12, alphanumeric: true });
    const db = getDB(await getParam("DB_URI"));

    await db.query(
      `
            INSERT INTO buildadmin_session (id, user_id, expires_at)
            VALUES ($1, $2, now() + interval '24 hours')
        `,
      [id, user.id],
    );


    return {
      id,
      user,
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
  const token = jwt.sign(
    {
      id: session.id,
      name: session.user.name,
      email: session.user.email,
      picture: session.user.imageUrl,
      userId: session.user.id,
    },
    process.env.HMAC_SECRET!,
    options,
  );
  return token;
}

export async function extendSession(session: Session): Promise<Session> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await db.query(
      `UPDATE buildadmin_session SET expires_at = now() + interval '24 hours' WHERE id = $1`,
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

export async function findSession(token: string): Promise<Session | undefined> {
  try {
    const decoded = jwt.verify(token, process.env.HMAC_SECRET!) as { id: string };
    const id = decoded.id;

    console.log("finding session", id);

    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(
      `
            SELECT
                buildadmin_session.id,
                buildadmin_session.user_id,
                buildadmin_session.expires_at,
                buildadmin_user.image_url
            FROM
                buildadmin_session
                JOIN buildadmin_user ON buildadmin_user.id = buildadmin_session.user_id
            WHERE
                buildadmin_session.id = $1
        `,
      [id],
    );

    if (result.rows.length === 0) {
      return;
    }

    const row = result.rows[0];
    const user = await getUser(row.user_id);
    if (!user) {
      return;
    }

    return {
      id: row.id,
      user,
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
            DELETE FROM buildadmin_session
            WHERE
                buildadmin_session.id = $1
        `,
      [id],
    );
  } catch (err) {
    logger.error("Failed to delete session", { err });
    throw err;
  }
}

