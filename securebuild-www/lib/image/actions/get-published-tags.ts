"use server"

import { Session } from "@/lib/types/session";
import { getPublishedTagsForImage } from "../image";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function getPublishedTagsActionImpl(
  sess: Session,
  imageId: string
): Promise<string[]> {
  try {
    return await getPublishedTagsForImage(imageId);
  } catch (error) {
    logger.error("Error in getPublishedTagsAction", error, {
      userId: sess.user.id,
      imageId
    });
    throw error;
  }
}

export const getPublishedTagsAction = traceServerAction('getPublishedTagsAction', getPublishedTagsActionImpl);
