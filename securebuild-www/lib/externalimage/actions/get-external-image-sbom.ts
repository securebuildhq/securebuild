"use server"

import { requireValidSession } from "@/lib/utils/session-validation"
import { getExternalImageDigestForTag, getExternalImageSbom } from "../externalimage"
import { Session } from "@/lib/types/session"
import { parseImageRef } from "../registry";
import { traceServerAction } from "@/lib/observability/tracing";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getExternalImageSbomActionImpl(sess: Session, imageName: string, imageTag: string, _imageArch: string) {
  const validatedSession = await requireValidSession(sess)

  const parsedImage = parseImageRef(imageName)

  const digest = await getExternalImageDigestForTag(validatedSession.selectedTeamId, parsedImage.registry, parsedImage.repository, imageTag)
  if (!digest) {
    return {
      error: "Digest not found for the specified tag",
    }
  }

  const sbom = await getExternalImageSbom(digest);

  if (sbom === null) {
    return { error: "SBOM not found" };
  }

  return sbom;
}

export const getExternalImageSbomAction = traceServerAction('getExternalImageSbomAction', getExternalImageSbomActionImpl);