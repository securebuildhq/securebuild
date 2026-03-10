"use server";

import { updateNotification } from "../notification";
import { Session } from "../../types/session";
import { NotificationEvent } from "../../types/notification";
import { requireValidSession } from "../../utils/session-validation";
import { traceServerAction } from "@/lib/observability/tracing";

export interface UpdateNotificationRequest {
  target?: string;
  webhookSecret?: string;
  events?: NotificationEvent[];
  tagFilterMode?: 'all' | 'specific';
  tagFilters?: string[];
}

async function updateNotificationActionImpl(
  sess: Session,
  notificationId: string,
  updates: UpdateNotificationRequest
): Promise<void> {
  await requireValidSession(sess);

  try {
    await updateNotification(notificationId, updates);
  } catch (error) {
    console.error("Error in updateNotificationAction:", error);
    throw error;
  }
}

export const updateNotificationAction = traceServerAction('updateNotificationAction', updateNotificationActionImpl);
