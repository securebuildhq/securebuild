"use server"

import { logger } from "@/lib/utils/logger";
import { extendSession, findSession } from "../session";
import { Session } from "@/lib/types/session";

export async function extendSessionAction(token: string): Promise<Session | undefined> {
  try {
    const session = await findSession(token);
    if (!session) {
      return;
    }

    const extendedSession = await extendSession(session);
    return extendedSession;
  } catch (err) {
    logger.error("Failed to extend session", err);
    throw err;
  }
}
