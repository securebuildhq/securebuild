"use server"

import { Session } from "@/lib/types/session";
import { getNotificationDeliveryStats } from "../notification";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function getNotificationDeliveryStatsActionImpl(
  sess: Session,
  since?: Date
): Promise<{
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  pendingDeliveries: number;
  successRate: number;
}> {
  try {
    return await getNotificationDeliveryStats(sess.selectedTeamId, since);
  } catch (error) {
    logger.error("Error in getNotificationDeliveryStatsAction", error, { userId: sess.user.id, since });
    throw error;
  }
}

export const getNotificationDeliveryStatsAction = traceServerAction('getNotificationDeliveryStatsAction', getNotificationDeliveryStatsActionImpl);
