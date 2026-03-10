"use server"

import { Session } from "@/lib/types/session";
import { NotificationDeliveryWithDetails, DeliveryStatus } from "@/lib/types/notification";
import { listNotificationDeliveries } from "../notification";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function listNotificationDeliveriesActionImpl(
  sess: Session,
  options?: {
    limit?: number;
    offset?: number;
    status?: DeliveryStatus;
    imageName?: string;
    since?: Date;
  }
): Promise<NotificationDeliveryWithDetails[]> {
  try {
    return await listNotificationDeliveries(sess.selectedTeamId, options);
  } catch (error) {
    logger.error("Error in listNotificationDeliveriesAction", error, { userId: sess.user.id, options });
    throw error;
  }
}

export const listNotificationDeliveriesAction = traceServerAction('listNotificationDeliveriesAction', listNotificationDeliveriesActionImpl);
