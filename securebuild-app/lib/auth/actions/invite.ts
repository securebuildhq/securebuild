"use server";

import crypto from "crypto";
import bcrypt from "bcrypt";
import * as srs from "secure-random-string";
import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";
import { getUser } from "@/lib/auth/user";
import { createSession, sessionToken } from "@/lib/auth/session";
import { sendAuthEmail } from "@/lib/auth/email";
import { getAppOrigin } from "@/lib/auth/actions/auth-config";
import { logger } from "@/lib/utils/logger";
import { getServerSession } from "@/lib/auth/server-session";

// Module-level rate limiter: tracks last email sent time per address
const lastSent = new Map<string, number>();

function canSendEmailTo(email: string): boolean {
  return Date.now() - (lastSent.get(email) || 0) >= 5000;
}

function recordEmailSent(email: string): void {
  lastSent.set(email, Date.now());
}

export interface InviteRecord {
  id: string;
  email: string;
  invitedByUserId: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
}

/**
 * Creates and sends an invite email to the given address.
 * Caller is responsible for verifying that the current user is an admin.
 * Throws if the email is already registered or already has a pending invite.
 */
export async function createInvite(email: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const normalizedEmail = email.toLowerCase().trim();
  const db = getDB(await getParam("DB_URI"));

  // Check if a user with this email already exists
  const existingUser = await db.query(
    `SELECT id FROM buildadmin_user WHERE email = $1`,
    [normalizedEmail],
  );
  if (existingUser.rows.length > 0) {
    throw new Error("A user with this email address already exists");
  }

  // Check if there is already a pending (not expired, not accepted) invite
  const existingInvite = await db.query(
    `SELECT id FROM buildadmin_invite
     WHERE email = $1
       AND expires_at > now()
       AND accepted_at IS NULL`,
    [normalizedEmail],
  );
  if (existingInvite.rows.length > 0) {
    throw new Error("An invite has already been sent to this email");
  }

  // Check rate limit before sending
  if (!canSendEmailTo(normalizedEmail)) {
    throw new Error("Please wait a moment before sending another invite to this address");
  }

  const inviteToken = crypto.randomBytes(32).toString("hex");
  const id = srs.default({ length: 12, alphanumeric: true });
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  try {
    const appOrigin = await getAppOrigin();
    const inviteLink = `${appOrigin}/auth/accept-invite?token=${inviteToken}`;

    // Send email before writing to DB — if email fails, no record is created
    await sendAuthEmail({
      to: normalizedEmail,
      subject: "You're invited to SecureBuild",
      html: `
        <p>You have been invited to join SecureBuild.</p>
        <p>Click the link below to accept the invitation and create your account. This link expires in 7 days.</p>
        <p><a href="${inviteLink}">${inviteLink}</a></p>
        <p>If you were not expecting this invitation, you can safely ignore this email.</p>
      `,
      text: `You have been invited to join SecureBuild.\n\nVisit the following link to accept the invitation and create your account (expires in 7 days):\n\n${inviteLink}\n\nIf you were not expecting this invitation, you can safely ignore this email.`,
    });

    await db.query(
      `INSERT INTO buildadmin_invite (id, email, invite_token, invited_by_user_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, now(), $5)`,
      [id, normalizedEmail, inviteToken, session.user.id, expiresAt],
    );

    recordEmailSent(normalizedEmail);
  } catch (err) {
    logger.error("Failed to create invite", { err, email: normalizedEmail });
    throw err;
  }
}

/**
 * Validates an invite token.
 * Returns the email address associated with the token if valid,
 * or null if the token is invalid, expired, or already accepted.
 */
export async function validateInviteToken(token: string): Promise<string | null> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(
      `SELECT email FROM buildadmin_invite
       WHERE invite_token = $1
         AND expires_at > now()
         AND accepted_at IS NULL`,
      [token],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].email as string;
  } catch (err) {
    logger.error("Failed to validate invite token", { err });
    return null;
  }
}

/**
 * Accepts an invite by validating the token, creating a new user account,
 * and setting the given password.
 * Returns a signed JWT token string on success.
 * Throws if the token is invalid, expired, or already accepted.
 */
export async function acceptInvite(token: string, password: string): Promise<string> {
  const db = getDB(await getParam("DB_URI"));

  const inviteResult = await db.query(
    `SELECT id, email FROM buildadmin_invite
     WHERE invite_token = $1
       AND expires_at > now()
       AND accepted_at IS NULL`,
    [token],
  );

  if (inviteResult.rows.length === 0) {
    throw new Error("Invalid or expired invite link");
  }

  const invite = inviteResult.rows[0] as { id: string; email: string };

  // Guard against race conditions: check user doesn't already exist
  const existingUser = await db.query(
    `SELECT id FROM buildadmin_user WHERE email = $1`,
    [invite.email],
  );
  if (existingUser.rows.length > 0) {
    throw new Error("An account with this email address already exists");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = srs.default({ length: 12, alphanumeric: true });

  await db.query(
    `INSERT INTO buildadmin_user (id, email, name, image_url, created_at, is_admin, password_hash)
     VALUES ($1, $2, $3, $4, now(), false, $5)`,
    [userId, invite.email, invite.email, "", passwordHash],
  );

  await db.query(
    `UPDATE buildadmin_invite SET accepted_at = now() WHERE id = $1`,
    [invite.id],
  );

  const user = await getUser(userId);
  if (!user) {
    throw new Error("User not found after accepting invite");
  }

  const sess = await createSession(user);
  const jwt = await sessionToken(sess);

  return jwt;
}

/**
 * Lists all invites for the admin UI.
 * Does NOT include the invite_token in the returned data.
 */
export async function listInvites(): Promise<InviteRecord[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(
      `SELECT id, email, invited_by_user_id, created_at, expires_at, accepted_at
       FROM buildadmin_invite
       ORDER BY created_at DESC`,
    );

    return result.rows.map((row) => ({
      id: row.id as string,
      email: row.email as string,
      invitedByUserId: row.invited_by_user_id as string,
      createdAt: row.created_at as Date,
      expiresAt: row.expires_at as Date,
      acceptedAt: row.accepted_at as Date | null,
    }));
  } catch (err) {
    logger.error("Failed to list invites", { err });
    throw err;
  }
}
