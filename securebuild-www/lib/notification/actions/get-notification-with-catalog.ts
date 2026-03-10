"use server"

import { getNotificationWithImage } from "../notification-with-image";
import { Session } from "../../types/session";
import { NotificationWithImage } from "../../types/notification";
import { traceServerAction } from "@/lib/observability/tracing";

async function getNotificationWithCatalogActionImpl(
  session: Session,
  notificationId: string
): Promise<NotificationWithImage | null> {
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  try {
    const notification = await getNotificationWithImage(notificationId);

    // Verify the notification belongs to the user's team
    if (notification && notification.teamId !== session.selectedTeamId) {
      throw new Error("Unauthorized");
    }

    return notification;
  } catch (error) {
    console.error("Error in getNotificationWithCatalogAction:", error);
    throw error;
  }
}

export const getNotificationWithCatalogAction = traceServerAction('getNotificationWithCatalogAction', getNotificationWithCatalogActionImpl);
