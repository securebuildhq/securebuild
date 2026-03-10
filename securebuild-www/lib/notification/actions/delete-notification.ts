"use server"

import { Session } from "@/lib/types/session";
import { deleteNotification } from "../notification";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function deleteNotificationActionImpl(
  sess: Session,
  notificationId: string
): Promise<void> {
  try {
    await deleteNotification(notificationId);
  } catch (error) {
    logger.error("Error in deleteNotificationAction", error, { userId: sess.user.id, notificationId });
    throw error;
  }
}

export const deleteNotificationAction = traceServerAction('deleteNotificationAction', deleteNotificationActionImpl);
