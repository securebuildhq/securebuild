"use server"

import { Session } from "@/lib/types/session";
import { NotificationEventWithDetails } from "@/lib/types/notification";
import { listNotificationEvents } from "../notification";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function listNotificationEventsActionImpl(
  sess: Session,
  options?: {
    limit?: number;
    offset?: number;
    status?: string;
    imageName?: string;
    since?: Date;
  }
): Promise<NotificationEventWithDetails[]> {
  try {
    return await listNotificationEvents(sess.selectedTeamId, options);
  } catch (error) {
    logger.error("Error in listNotificationEventsAction", error, { userId: sess.user.id, options });
    throw error;
  }
}

export const listNotificationEventsAction = traceServerAction('listNotificationEventsAction', listNotificationEventsActionImpl);
