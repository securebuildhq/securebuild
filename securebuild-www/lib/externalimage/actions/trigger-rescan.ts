"use server"

import { requireValidSession } from "@/lib/utils/session-validation"
import { getExternalImageDigestForTag, resetScanStatus, getExternalImageScan, ScanStatusEntry, ScanStatus, getExternalImageCredentials, updateTagDigest, getScanAttemptedAt } from "../externalimage"
import { Session } from "@/lib/types/session"
import { parseImageRef, getImageDigest } from "../registry"
import { enqueueWorkWithPriority, PRIORITY_HIGH } from "@/lib/utils/queue"

export interface TriggerRescanResult {
  success: boolean
  digest: string
  message: string
}

export interface ScanStatusResult {
  digest: string
  hasScan: boolean
  scans: ScanStatusEntry[]
  scanAttemptedAt: Date | null
}

/**
 * Trigger a rescan for an external image.
 * This resets the status to queued and enqueues work to the external_image_sbom
 * queue with enqueue_rescan_after=true, which causes the scan to run immediately.
 */
export async function triggerRescanAction(
  sess: Session,
  imageName: string,
  imageTag: string
): Promise<TriggerRescanResult | { error: string }> {
  const validatedSession = await requireValidSession(sess)

  const parsedImage = parseImageRef(imageName)

  // Get the current stored digest (validates team access)
  const storedDigest = await getExternalImageDigestForTag(
    validatedSession.selectedTeamId,
    parsedImage.registry,
    parsedImage.repository,
    imageTag
  )

  if (!storedDigest) {
    return {
      error: "Digest not found for the specified tag",
    }
  }

  // Fetch the latest digest from the registry
  // This detects if the tag has been updated to a new image
  let digest: string
  let credentials: { username: string; password: string } | null
  try {
    credentials = await getExternalImageCredentials(validatedSession.selectedTeamId, parsedImage.registry, parsedImage.repository)
  } catch (err) {
    console.error(`Failed to get credentials: ${err instanceof Error ? err.message : "Unknown error"}`)
    return {
      error: `Failed to get credentials: ${err instanceof Error ? err.message : "Unknown error"}`,
    }
  }

  // Use the actual imageTag parameter, not parsedImage.tag (which defaults to "latest")
  const imageRef = { ...parsedImage, tag: imageTag }
  let registryDigest: string
  try {
    registryDigest = await getImageDigest(imageRef, credentials ?? undefined, true)
  } catch (err) {
    console.error(`Failed to fetch latest digest from registry: ${err instanceof Error ? err.message : "Unknown error"}`)

    const errorMessage = err instanceof Error ? err.message : "Unknown error"

    // Classify registry/API errors so we show accurate user-facing messages.
    // Match status codes as whole tokens so port numbers (e.g. 4040) in URLs don't match.
    const hasStatus401 = /\b401\b/.test(errorMessage)
    const hasStatus403 = /\b403\b/.test(errorMessage)
    const hasStatus404 = /\b404\b/.test(errorMessage)
    const hasStatus5xx = /\b5\d{2}\b/.test(errorMessage)

    const isAccessError =
      errorMessage.includes("authentication required") ||
      errorMessage.includes("not found") ||
      errorMessage.includes("forbidden") ||
      hasStatus401 ||
      hasStatus403 ||
      hasStatus404

    const isServerError = hasStatus5xx
    const isManifestDigestError = errorMessage.includes("Unable to determine manifest digest")

    let userMessage: string
    if (isAccessError) {
      userMessage =
        "Unable to access image in registry. The image may have been deleted or may require valid credentials."
    } else if (isServerError) {
      userMessage = "Registry is temporarily unavailable. Please try again later."
    } else if (isManifestDigestError) {
      userMessage =
        "Unable to determine image digest from registry. The image format may not be supported."
    } else {
      userMessage =
        "Failed to get image from registry. Please try again or check your credentials and registry access."
    }

    return {
      error: userMessage,
    }
  }

  try {
    if (registryDigest !== storedDigest) {
      console.log(`Tag digest changed: stored=${storedDigest} registry=${registryDigest}`)
      // Update the tag's digest in the database
      await updateTagDigest(parsedImage.registry, parsedImage.repository, imageTag, registryDigest)
    }
    digest = registryDigest

    // Reset scan status to queued for the (possibly new) digest
    // This handles both cases: same digest rescan, or new digest that might have prior scan records
    // Note: scan_attempted_at will be set when the scan starts (SetScanStatusRunning in Go)
    await resetScanStatus(digest)
  } catch (err) {
    console.error(`Failed to update scan status: ${err instanceof Error ? err.message : "Unknown error"}`)
    return {
      error: `Failed to update scan status: ${err instanceof Error ? err.message : "Unknown error"}`,
    }
  }

  try {

    // Enqueue to external_image_sbom with high priority and enqueue_rescan_after=true
    // High priority ensures rescans jump ahead of initial scans in the queue
    // enqueue_rescan_after causes the handler to run scan immediately after verifying SBOM exists
    await enqueueWorkWithPriority('external_image_sbom', {
      digest: digest,
      enqueue_rescan_after: true,
    }, PRIORITY_HIGH)

    return {
      success: true,
      digest,
      message: "Rescan request queued successfully",
    }
  } catch (error) {
    console.error("Failed to trigger rescan:", error)
    return {
      error: `Failed to trigger rescan: ${error instanceof Error ? error.message : "Unknown error"}`,
    }
  }
}

/**
 * Get the scan status for an external image.
 * Returns status for each architecture (queued, running, succeeded, failed).
 */
export async function getScanStatusAction(
  sess: Session,
  imageName: string,
  imageTag: string
): Promise<ScanStatusResult | { error: string }> {
  const validatedSession = await requireValidSession(sess)

  const parsedImage = parseImageRef(imageName)

  const digest = await getExternalImageDigestForTag(
    validatedSession.selectedTeamId,
    parsedImage.registry,
    parsedImage.repository,
    imageTag
  )

  if (!digest) {
    return {
      error: "Digest not found for the specified tag",
    }
  }

  try {
    // Get scan status for both architectures using the unified function
    const [amd64Scan, arm64Scan, scanAttemptedAt] = await Promise.all([
      getExternalImageScan(digest, 'x86_64', 'parsed'),
      getExternalImageScan(digest, 'aarch64', 'parsed'),
      getScanAttemptedAt(digest),
    ])

    const scanStatuses: ScanStatusEntry[] = []

    if (amd64Scan) {
      scanStatuses.push({
        digest: digest,
        arch: 'x86_64',
        status: amd64Scan.status as ScanStatus,
        scanStatusMessage: amd64Scan.scanStatusMessage,
        createdAt: new Date(amd64Scan.scanCreatedAt),
        updatedAt: amd64Scan.updatedAt,
        scanAttemptedAt: amd64Scan.scanAttemptedAt,
        scanCompletedAt: amd64Scan.scanCompletedAt,
        scanStatusUpdatedAt: amd64Scan.scanStatusUpdatedAt,
        imageDigest: amd64Scan.imageDigest,
      })
    }

    if (arm64Scan) {
      scanStatuses.push({
        digest: digest,
        arch: 'aarch64',
        status: arm64Scan.status as ScanStatus,
        scanStatusMessage: arm64Scan.scanStatusMessage,
        createdAt: new Date(arm64Scan.scanCreatedAt),
        updatedAt: arm64Scan.updatedAt,
        scanAttemptedAt: arm64Scan.scanAttemptedAt,
        scanCompletedAt: arm64Scan.scanCompletedAt,
        scanStatusUpdatedAt: arm64Scan.scanStatusUpdatedAt,
        imageDigest: arm64Scan.imageDigest,
      })
    }

    return {
      digest,
      hasScan: scanStatuses.length > 0,
      scans: scanStatuses,
      scanAttemptedAt,
    }
  } catch (error) {
    console.error("Failed to get scan status:", error)
    return {
      error: `Failed to get scan status: ${error instanceof Error ? error.message : "Unknown error"}`,
    }
  }
}
