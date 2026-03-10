"use server"

import { TrackedExternalImage } from "@/lib/types/externalimage";
import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { getExternalImageForTeam } from "../externalimage";
import { parseImageRef } from "../registry";
import { traceServerAction } from "@/lib/observability/tracing";

async function getExternalImageActionImpl(sess: Session, imageName: string): Promise<TrackedExternalImage | { error: string }> {
  const team = await requireValidSession(sess)
  if (!team) {
    return {
      error: "Invalid session",
    }
  }

  const parsedImage = parseImageRef(imageName)
  const externalImage = await getExternalImageForTeam(team.selectedTeamId, parsedImage.registry, parsedImage.repository)
  if (!externalImage) {
    return {
      error: "Image not found",
    }
  }

  return externalImage;
}

export const getExternalImageAction = traceServerAction('getExternalImageAction', getExternalImageActionImpl);