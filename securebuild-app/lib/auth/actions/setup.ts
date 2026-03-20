"use server";

import crypto from "crypto";
import * as srs from "secure-random-string";
import bcrypt from "bcrypt";
import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";
import { logger } from "@/lib/utils/logger";
import { createSession, sessionToken } from "@/lib/auth/session";
import { getUser } from "@/lib/auth/user";
import { sendAuthEmail, canSendEmailTo, recordEmailSent } from "@/lib/auth/email";
import { getAppOrigin } from "@/lib/auth/actions/auth-config";

export type SetupState = "setup-needed" | "pending-user" | "complete";

export interface GetSetupStateResult {
  state: SetupState;
  pendingEmail?: string;
}

/**
 * Determines the current setup state:
 * - "setup-needed"  = 0 users in DB (show email input form)
 * - "pending-user"  = 1 user with null password_hash (show resend form with email)
 * - "complete"      = at least one user with a password_hash set
 */
export async function getSetupState(): Promise<GetSetupStateResult> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const countResult = await db.query(
      `SELECT COUNT(1) as total FROM buildadmin_user`,
    );
    const total = parseInt(countResult.rows[0].total, 10);

    if (total === 0) {
      return { state: "setup-needed" };
    }

    // Check whether any user has a password_hash set
    const completedResult = await db.query(
      `SELECT COUNT(1) as completed FROM buildadmin_user WHERE password_hash IS NOT NULL`,
    );
    const completed = parseInt(completedResult.rows[0].completed, 10);

    if (completed > 0) {
      return { state: "complete" };
    }

    // There is at least one user but no passwords set — find the pending user
    const pendingResult = await db.query(
      `SELECT email FROM buildadmin_user WHERE password_hash IS NULL LIMIT 1`,
    );

    const pendingEmail =
      pendingResult.rows.length > 0 ? pendingResult.rows[0].email : undefined;

    return { state: "pending-user", pendingEmail };
  } catch (err) {
    logger.error("Failed to get setup state", err);
    throw err;
  }
}

/**
 * Step 1 of initial setup: accepts an email address, creates the first admin
 * user row (or reuses an existing pending one), and sends a setup link.
 */
export async function submitSetupEmail(email: string): Promise<void> {
  if (!email) {
    throw new Error("Email is required");
  }

  const normalizedEmail = email.toLowerCase().trim();

  const canSend = await canSendEmailTo(normalizedEmail);
  if (!canSend) {
    throw new Error("Please wait a few seconds before requesting another email");
  }

  try {
    const db = getDB(await getParam("DB_URI"));
    const appOrigin = await getAppOrigin();

    const nonce = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Check whether the user already exists
    const existingResult = await db.query(
      `SELECT id, password_hash FROM buildadmin_user WHERE email = $1`,
      [normalizedEmail],
    );

    if (existingResult.rows.length === 0) {
      // Insert new pending admin user
      const id = srs.default({ length: 12, alphanumeric: true });

      await db.query(
        `INSERT INTO buildadmin_user
          (id, email, name, image_url, is_admin, created_at,
           password_reset_nonce, password_reset_nonce_expires_at)
         VALUES ($1, $2, $3, $4, $5, now(), $6, $7)`,
        [id, normalizedEmail, normalizedEmail, "", true, nonce, expiresAt],
      );
    } else {
      const existing = existingResult.rows[0];

      if (existing.password_hash !== null) {
        throw new Error(
          "A user with this email already exists and has completed setup",
        );
      }

      // Update the nonce for the pending user
      await db.query(
        `UPDATE buildadmin_user
         SET password_reset_nonce = $1, password_reset_nonce_expires_at = $2
         WHERE email = $3`,
        [nonce, expiresAt, normalizedEmail],
      );
    }

    const setupLink = `${appOrigin}/auth/setup?nonce=${nonce}`;

    await sendAuthEmail({
      to: normalizedEmail,
      subject: "Complete your SecureBuild setup",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Complete your SecureBuild setup</h2>
          <p>You have been invited to set up the SecureBuild admin dashboard.</p>
          <p>Click the link below to set your password and complete your account setup:</p>
          <p>
            <a href="${setupLink}" style="
              display: inline-block;
              background-color: #374151;
              color: #ffffff;
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
            ">Complete Setup</a>
          </p>
          <p style="color: #6b7280; font-size: 14px;">
            This link expires in 24 hours. If you did not request this, you can safely ignore it.
          </p>
          <p style="color: #6b7280; font-size: 14px;">
            Or copy and paste this URL into your browser:<br />
            <code>${setupLink}</code>
          </p>
        </div>
      `,
      text: `Complete your SecureBuild setup\n\nVisit this link to set your password:\n${setupLink}\n\nThis link expires in 24 hours.`,
    });

    await recordEmailSent(normalizedEmail);

    logger.info("Setup email sent", { email: normalizedEmail });
  } catch (err) {
    logger.error("Failed to submit setup email", err, { email });
    throw err;
  }
}

/**
 * Re-sends the setup email to the single pending user (null password_hash).
 * Generates a fresh nonce.
 */
export async function resendSetupEmail(): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const appOrigin = await getAppOrigin();

    const pendingResult = await db.query(
      `SELECT id, email FROM buildadmin_user
       WHERE password_hash IS NULL AND password_reset_nonce IS NOT NULL
       LIMIT 1`,
    );

    if (pendingResult.rows.length === 0) {
      throw new Error("No pending user found");
    }

    const pendingUser = pendingResult.rows[0];
    const email: string = pendingUser.email;

    const canSend = await canSendEmailTo(email);
    if (!canSend) {
      throw new Error("Please wait a few seconds before requesting another email");
    }

    const nonce = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      `UPDATE buildadmin_user
       SET password_reset_nonce = $1, password_reset_nonce_expires_at = $2
       WHERE id = $3`,
      [nonce, expiresAt, pendingUser.id],
    );

    const setupLink = `${appOrigin}/auth/setup?nonce=${nonce}`;

    await sendAuthEmail({
      to: email,
      subject: "Complete your SecureBuild setup",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Complete your SecureBuild setup</h2>
          <p>Here is your updated setup link:</p>
          <p>
            <a href="${setupLink}" style="
              display: inline-block;
              background-color: #374151;
              color: #ffffff;
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
            ">Complete Setup</a>
          </p>
          <p style="color: #6b7280; font-size: 14px;">
            This link expires in 24 hours. If you did not request this, you can safely ignore it.
          </p>
          <p style="color: #6b7280; font-size: 14px;">
            Or copy and paste this URL into your browser:<br />
            <code>${setupLink}</code>
          </p>
        </div>
      `,
      text: `Complete your SecureBuild setup\n\nVisit this link to set your password:\n${setupLink}\n\nThis link expires in 24 hours.`,
    });

    await recordEmailSent(email);

    logger.info("Setup email resent", { email });
  } catch (err) {
    logger.error("Failed to resend setup email", err);
    throw err;
  }
}

/**
 * Step 2 of initial setup: validates the nonce, hashes the password, marks
 * the user as active, and returns a signed session JWT.
 */
export async function completeSetup(
  nonce: string,
  password: string,
): Promise<string> {
  if (!nonce || !password) {
    throw new Error("Nonce and password are required");
  }

  try {
    const db = getDB(await getParam("DB_URI"));

    // Find the user by nonce, ensuring it has not expired and has no password yet
    const result = await db.query(
      `SELECT id FROM buildadmin_user
       WHERE password_reset_nonce = $1
         AND password_reset_nonce_expires_at > now()
         AND password_hash IS NULL`,
      [nonce],
    );

    if (result.rows.length === 0) {
      throw new Error("Invalid or expired setup link");
    }

    const userId: string = result.rows[0].id;

    const passwordHash = await bcrypt.hash(password, 12);

    await db.query(
      `UPDATE buildadmin_user
       SET password_hash = $1,
           password_reset_nonce = NULL,
           password_reset_nonce_expires_at = NULL,
           last_login_at = now(),
           last_active_at = now()
       WHERE id = $2`,
      [passwordHash, userId],
    );

    const user = await getUser(userId);
    if (!user) {
      throw new Error("User not found after setup");
    }

    const sess = await createSession(user);
    const jwt = await sessionToken(sess);

    logger.info("Setup completed for user", { userId });

    return jwt;
  } catch (err) {
    logger.error("Failed to complete setup", err);
    throw err;
  }
}
