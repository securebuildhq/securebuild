"use server"

import { Session } from "@/lib/types/session";
import { retryNotificationEvent } from "../notification";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function retryNotificationEventActionImpl(
  sess: Session,
  eventId: string
): Promise<void> {
  try {
    await retryNotificationEvent(eventId, sess.user.id);
  } catch (error) {
    logger.error("Error in retryNotificationEventAction", error, { userId: sess.user.id, eventId });
    throw error;
  }
}

export const retryNotificationEventAction = traceServerAction('retryNotificationEventAction', retryNotificationEventActionImpl);
