"use server"

import { Session } from "@/lib/types/session";
import { CreateNotificationRequest, NotificationWithImage } from "@/lib/types/notification";
import { createNotification, listNotifications } from "../notification";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function createNotificationActionImpl(
  sess: Session,
  request: CreateNotificationRequest
): Promise<NotificationWithImage[]> {
  try {
    logger.info("Creating notification", {
      userId: sess.user.id,
      teamId: sess.selectedTeamId,
      request,
    });

    await createNotification(sess.selectedTeamId, request);

    // Return the updated list of notifications
    return await listNotifications(sess.selectedTeamId);
  } catch (error) {
    logger.error("Error in createNotificationAction", error, {
      userId: sess.user.id,
      teamId: sess.selectedTeamId,
      request,
    });
    throw error;
  }
}

export const createNotificationAction = traceServerAction('createNotificationAction', createNotificationActionImpl);
