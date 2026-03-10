"use server"

import { Session } from "@/lib/types/session";
import { listOrgImages } from "../image";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function listSubscribedImagesActionImpl(
  sess: Session
): Promise<Array<{id: string, name: string, catalogItemId: string}>> {
  try {
    const images = await listOrgImages(sess.selectedTeamId);

    // Return image data with catalog item ID for creating notifications
    return images.map(image => ({
      id: image.id,
      name: image.name,
      catalogItemId: image.catalogItem?.id || ''
    })).filter(image => image.catalogItemId); // Only include images that have catalog items
  } catch (error) {
    logger.error("Error in listSubscribedImagesAction", error, {
      userId: sess.user.id,
      teamId: sess.selectedTeamId
    });
    throw error;
  }
}

export const listSubscribedImagesAction = traceServerAction('listSubscribedImagesAction', listSubscribedImagesActionImpl);
