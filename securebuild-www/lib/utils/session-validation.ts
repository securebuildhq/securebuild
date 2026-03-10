import { Session } from "@/lib/types/session";
import { findSession } from "@/lib/user/session";
import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";

/**
 * Updates the user's last_active_at timestamp to the current UTC time
 */
async function updateUserLastActive(userId: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const now = new Date(); // Current UTC time calculated client-side

    await db.query(
      `UPDATE securebuild_user SET last_active_at = $1 WHERE id = $2`,
      [now, userId]
    );
  } catch (error) {
    // Don't throw - we don't want activity tracking to break the main functionality
    console.error("Failed to update user last_active_at:", error);
  }
}

/**
 * Validates that a session exists and is not expired
 * Throws an error if validation fails
 * Returns the fresh session from the database
 * Updates user's last_active_at timestamp on successful validation
 */
export async function requireValidSession(sess: Session): Promise<Session> {
  // Validate session exists
  const currentSession = await findSession(undefined, sess.id);
  if (!currentSession) {
    throw new Error("Session not found");
  }

  // Validate session is not expired
  if (currentSession.expiresAt < new Date()) {
    throw new Error("Session expired");
  }

  // Update user activity tracking
  await updateUserLastActive(currentSession.user.id);

  return currentSession;
}

/**
 * Validates an optional session - returns the validated session if valid, undefined if not
 * Does not throw errors - gracefully handles invalid/missing sessions
 * Returns undefined if session is null, invalid, or expired
 * Updates user's last_active_at timestamp on successful validation
 */
export async function optionalValidSession(sess: Session | undefined): Promise<Session | undefined> {
  if (!sess) {
    return undefined;
  }

  try {
    // Validate session exists
    const currentSession = await findSession(undefined, sess.id);
    if (!currentSession) {
      return undefined;
    }

    // Validate session is not expired
    if (currentSession.expiresAt < new Date()) {
      return undefined;
    }

    // Update user activity tracking
    await updateUserLastActive(currentSession.user.id);

    return currentSession;
  } catch {
    // If any error occurs during validation, return undefined
    return undefined;
  }
}

/**
 * Session validation wrapper for actions that require a valid session
 * Note: This wrapper approach may not work with Next.js "use server" files
 * Consider using requireValidSession() directly in your actions instead
 */
export function withRequiredSession<T extends any[], R>(
  action: (sess: Session, ...args: T) => Promise<R>
) {
  return async (sess: Session, ...args: T): Promise<R> => {
    const validatedSession = await requireValidSession(sess);
    return action(validatedSession, ...args);
  };
}
