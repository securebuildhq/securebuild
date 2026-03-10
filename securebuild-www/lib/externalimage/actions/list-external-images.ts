"use server"

import { TrackedExternalImage } from "../../types/externalimage";
import { Session } from "../../types/session";
import { requireValidSession } from "../../utils/session-validation";
import { listExternalImages } from "../externalimage";
import { traceServerAction } from "@/lib/observability/tracing";

async function listExternalImagesActionImpl(sess: Session): Promise<TrackedExternalImage[]> {
  const validatedSession = await requireValidSession(sess);

  const externalImages = await listExternalImages(validatedSession.selectedTeamId);

  return externalImages;
}

export const listExternalImagesAction = traceServerAction('listExternalImagesAction', listExternalImagesActionImpl);
