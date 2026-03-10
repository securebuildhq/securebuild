"use server";

import { Session } from "@/lib/types/session";
import { findSession } from "@/lib/user/session";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function validateSessionImpl(token: string): Promise<Session | undefined> {
  try {
    const session = await findSession(token, undefined);
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

export const validateSession = traceServerAction('validateSession', validateSessionImpl);
