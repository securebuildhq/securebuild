"use server"

import { Session } from "@/lib/types/session";
import { updateNotificationEnabled } from "../notification";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function updateNotificationEnabledActionImpl(
  sess: Session,
  notificationId: string,
  enabled: boolean
): Promise<void> {
  try {
    await updateNotificationEnabled(notificationId, enabled);
  } catch (error) {
    logger.error("Error in updateNotificationEnabledAction", error, { userId: sess.user.id, notificationId, enabled });
    throw error;
  }
}

export const updateNotificationEnabledAction = traceServerAction('updateNotificationEnabledAction', updateNotificationEnabledActionImpl);
