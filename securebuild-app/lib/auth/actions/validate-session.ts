"use server";

import { Session } from "@/lib/types/session";
import { findSession } from "../session";
import { logger } from "@/lib/utils/logger";

export async function validateSession(token: string): Promise<Session | undefined> {
  try {
    const session = await findSession(token);
    if (!session) {
      return;
    }

    if (session.expiresAt < new Date()) {
      return;
    }

    return session;
  } catch (err) {
    logger.error("Failed to validate session", err);
    throw err;
  }
}
