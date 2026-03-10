"use server"

import { Session } from "@/lib/types/session";
import { getNotificationEventStats } from "../notification";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function getNotificationEventStatsActionImpl(
  sess: Session,
  since?: Date
): Promise<{
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  pendingEvents: number;
  successRate: number;
}> {
  try {
    return await getNotificationEventStats(sess.selectedTeamId, since);
  } catch (error) {
    logger.error("Error in getNotificationEventStatsAction", error, { userId: sess.user.id, since });
    throw error;
  }
}

export const getNotificationEventStatsAction = traceServerAction('getNotificationEventStatsAction', getNotificationEventStatsActionImpl);
