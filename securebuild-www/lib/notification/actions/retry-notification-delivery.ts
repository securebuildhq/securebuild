"use server"

import { Session } from "@/lib/types/session";
import { retryNotificationDelivery } from "../notification";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function retryNotificationDeliveryActionImpl(
  sess: Session,
  deliveryId: string
): Promise<void> {
  try {
    await retryNotificationDelivery(deliveryId, sess.user.id);
  } catch (error) {
    logger.error("Error in retryNotificationDeliveryAction", error, { userId: sess.user.id, deliveryId });
    throw error;
  }
}

export const retryNotificationDeliveryAction = traceServerAction('retryNotificationDeliveryAction', retryNotificationDeliveryActionImpl);
