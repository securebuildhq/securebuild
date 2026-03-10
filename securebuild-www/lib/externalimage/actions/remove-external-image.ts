"use server"

import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { getExternalImageForTeam, unlinkExternalImage } from "../externalimage";
import { traceServerAction } from "@/lib/observability/tracing";

async function removeExternalImageActionImpl(sess: Session, registry: string, imageName: string) {
  const validatedSession = await requireValidSession(sess)

  const externalImage = await getExternalImageForTeam(validatedSession.selectedTeamId, registry, imageName)

  if (!externalImage) {
    throw new Error("External image not found")
  }

  await unlinkExternalImage(validatedSession.selectedTeamId, externalImage.registry, externalImage.imageName);
}

export const removeExternalImageAction = traceServerAction('removeExternalImageAction', removeExternalImageActionImpl);