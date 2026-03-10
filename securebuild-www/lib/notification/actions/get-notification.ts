"use server"

import { getNotification } from "../notification";
import { Session } from "../../types/session";
import { Notification } from "../../types/notification";
import { traceServerAction } from "@/lib/observability/tracing";

async function getNotificationActionImpl(
  session: Session,
  notificationId: string
): Promise<Notification | null> {
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  try {
    const notification = await getNotification(notificationId);

    // Verify the notification belongs to the user's team
    if (notification && notification.teamId !== session.selectedTeamId) {
      throw new Error("Unauthorized");
    }

    return notification;
  } catch (error) {
    console.error("Error in getNotificationAction:", error);
    throw error;
  }
}

export const getNotificationAction = traceServerAction('getNotificationAction', getNotificationActionImpl);
