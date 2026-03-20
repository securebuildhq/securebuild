"use server";

import { logger } from "@/lib/utils/logger";
import { findUser } from "@/lib/auth/user";
import { createSession, sessionToken } from "@/lib/auth/session";
import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";
import bcrypt from "bcrypt";

/**
 * Authenticates a user with email and password.
 * Returns a signed JWT on success, or throws an error on failure.
 */
export async function passwordLogin(email: string, password: string): Promise<string> {
  if (!email || !password) {
    throw new Error("Email and password are required");
  }

  try {
    const db = getDB(await getParam("DB_URI"));

    // Look up the user and their stored password hash
    const result = await db.query(
      `SELECT id, password_hash FROM buildadmin_user WHERE email = $1`,
      [email.toLowerCase().trim()],
    );

    if (result.rows.length === 0) {
      throw new Error("Invalid email or password");
    }

    const row = result.rows[0];

    if (!row.password_hash) {
      throw new Error("Password login is not configured for this account");
    }

    const isValid = await bcrypt.compare(password, row.password_hash);
    if (!isValid) {
      throw new Error("Invalid email or password");
    }

    // Record login timestamps
    await db.query(
      `UPDATE buildadmin_user SET last_login_at = now(), last_active_at = now() WHERE id = $1`,
      [row.id],
    );

    const user = await findUser(email.toLowerCase().trim());
    if (!user) {
      throw new Error("User not found");
    }

    const sess = await createSession(user);
    const jwt = await sessionToken(sess);

    return jwt;
  } catch (err) {
    logger.error("Password login failed", { err, email });
    throw err;
  }
}
