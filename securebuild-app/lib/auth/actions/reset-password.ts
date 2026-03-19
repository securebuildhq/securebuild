"use server";

import crypto from "crypto";
import bcrypt from "bcrypt";
import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";
import { getUser } from "@/lib/auth/user";
import { createSession, sessionToken } from "@/lib/auth/session";
import { sendAuthEmail } from "@/lib/auth/email";
import { getAppOrigin } from "@/lib/auth/actions/auth-config";
import { logger } from "@/lib/utils/logger";

// Module-level rate limiter: tracks last email sent time per address
const lastSent = new Map<string, number>();

function canSendEmailTo(email: string): boolean {
  return Date.now() - (lastSent.get(email) || 0) >= 5000;
}

function recordEmailSent(email: string): void {
  lastSent.set(email, Date.now());
}

/**
 * Requests a password reset for the given email address.
 * Does not reveal whether the email exists (always returns silently).
 * Sends a reset link only if the user exists and has password auth configured.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  // Silently ignore if rate limited - do not reveal timing information
  if (!canSendEmailTo(email)) {
    return;
  }

  try {
    const db = getDB(await getParam("DB_URI"));

    // Only look up users that have password auth configured
    const result = await db.query(
      `SELECT id, email FROM buildadmin_user WHERE email = $1 AND password_hash IS NOT NULL`,
      [email.toLowerCase().trim()],
    );

    // Silently return if user not found - do not reveal existence
    if (result.rows.length === 0) {
      return;
    }

    const row = result.rows[0];

    const nonce = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await db.query(
      `UPDATE buildadmin_user
       SET password_reset_nonce = $1, password_reset_nonce_expires_at = $2
       WHERE id = $3`,
      [nonce, expiresAt, row.id],
    );

    const appOrigin = await getAppOrigin();
    const resetLink = `${appOrigin}/auth/reset-password?nonce=${nonce}`;

    await sendAuthEmail({
      to: row.email,
      subject: "Reset your SecureBuild password",
      html: `
        <p>You requested a password reset for your SecureBuild account.</p>
        <p>Click the link below to set a new password. This link expires in 24 hours.</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>If you did not request this, you can safely ignore this email.</p>
      `,
      text: `You requested a password reset for your SecureBuild account.\n\nVisit the following link to set a new password (expires in 24 hours):\n\n${resetLink}\n\nIf you did not request this, you can safely ignore this email.`,
    });

    recordEmailSent(email);
  } catch (err) {
    logger.error("Failed to process password reset request", { err, email });
    // Do not rethrow - silently absorb errors to avoid information leakage
  }
}

/**
 * Validates that a password reset nonce is still valid (exists and not expired).
 * Returns true if the nonce is valid.
 */
export async function validateResetNonce(nonce: string): Promise<boolean> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(
      `SELECT COUNT(1) AS count
       FROM buildadmin_user
       WHERE password_reset_nonce = $1
         AND password_reset_nonce_expires_at > now()`,
      [nonce],
    );

    return parseInt(result.rows[0].count, 10) > 0;
  } catch (err) {
    logger.error("Failed to validate reset nonce", { err });
    return false;
  }
}

/**
 * Sets a new password using a valid reset nonce.
 * Returns a signed JWT token string on success.
 * Throws if the nonce is invalid or expired.
 */
export async function resetPassword(nonce: string, password: string): Promise<string> {
  const db = getDB(await getParam("DB_URI"));

  const result = await db.query(
    `SELECT id, email
     FROM buildadmin_user
     WHERE password_reset_nonce = $1
       AND password_reset_nonce_expires_at > now()`,
    [nonce],
  );

  if (result.rows.length === 0) {
    throw new Error("Invalid or expired reset link");
  }

  const row = result.rows[0];

  const passwordHash = await bcrypt.hash(password, 12);

  await db.query(
    `UPDATE buildadmin_user
     SET password_hash = $1,
         password_reset_nonce = NULL,
         password_reset_nonce_expires_at = NULL,
         last_login_at = now(),
         last_active_at = now()
     WHERE id = $2`,
    [passwordHash, row.id],
  );

  const user = await getUser(row.id);
  if (!user) {
    throw new Error("User not found after password reset");
  }

  const sess = await createSession(user);
  const jwt = await sessionToken(sess);

  return jwt;
}
