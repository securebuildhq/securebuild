"use server"

import { logger } from "@/lib/utils/logger";
import { extendSession } from "@/lib/user/session";
import { findSession } from "@/lib/user/session";
import { traceServerAction } from "@/lib/observability/tracing";

async function extendSessionActionImpl(token: string): Promise<void> {
  try {
    const session = await findSession(token, undefined);
    if (!session) {
      return;
    }

    await extendSession(session);
  } catch (err) {
    logger.error("Failed to extend session", err);
    throw err;
  }
}

export const extendSessionAction = traceServerAction('extendSessionAction', extendSessionActionImpl);
