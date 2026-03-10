"use server"

import { Session } from "@/lib/types/session";
import { NotificationWithImage } from "@/lib/types/notification";
import { listNotifications } from "../notification";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function listNotificationsActionImpl(
  sess: Session
): Promise<NotificationWithImage[]> {
  try {
    return await listNotifications(sess.selectedTeamId);
  } catch (error) {
    logger.error("Error in listNotificationsAction", error, { userId: sess.user.id });
    throw error;
  }
}

export const listNotificationsAction = traceServerAction('listNotificationsAction', listNotificationsActionImpl);
