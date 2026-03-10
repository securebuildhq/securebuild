"use server"

import { Image } from "@/lib/types/image";
import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { traceServerAction } from "@/lib/observability/tracing";
import { listOrgImages } from "../image";

async function listOrgImagesActionImpl(sess: Session): Promise<Image[]> {
  const validatedSession = await requireValidSession(sess);
  const images = await listOrgImages(validatedSession.selectedTeamId);
  return images;
}

export const listOrgImagesAction = traceServerAction('listOrgImagesAction', listOrgImagesActionImpl);
