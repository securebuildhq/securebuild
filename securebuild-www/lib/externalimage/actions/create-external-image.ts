"use server"

import { Session } from "@/lib/types/session";
import { upsertExternalImage } from "../externalimage";
import { enqueueWork, hasExistingSBOM } from "@/lib/utils/queue";
import { getImageDigest } from "../registry";
import { parseImageRef } from "../registry";
import { traceServerAction } from "@/lib/observability/tracing";

async function createExternalImageActionImpl(sess: Session, imageURL: string, username: string | null, password: string | null) {
  try {
    const credentials = {
      username: username || undefined,
      password: password || undefined,
    }

    const imageUrlParsed = parseImageRef(imageURL)

    const digest = await getImageDigest(imageUrlParsed, credentials)

    const externalImage = await upsertExternalImage(imageUrlParsed.registry, imageUrlParsed.repository, imageUrlParsed.tag, digest, username, password, sess.selectedTeamId)

    // Only enqueue SBOM work if needed (no existing SBOM)
    // This prevents duplicate work items and unnecessary processing
    // Note: The HandleExternalImageSbom handler will initialize scan status if needed
    const shouldSkipSBOM = await hasExistingSBOM(digest)
    if (!shouldSkipSBOM) {
      await enqueueWork('external_image_sbom', {
        digest: digest,
      })
    }

    return externalImage
  } catch (err) {
    console.error("createExternalImageAction error:", err)
    return { error: err instanceof Error ? err.message : "Failed to add external image" }
  }
}

export const createExternalImageAction = traceServerAction('createExternalImageAction', createExternalImageActionImpl);
