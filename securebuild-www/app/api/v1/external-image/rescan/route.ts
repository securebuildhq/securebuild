import { NextRequest, NextResponse } from 'next/server'
import { findServiceAccountWithValue } from '@/lib/team/service-account'
import { getExternalImageDigestForTag, resetScanStatus, getExternalImageCredentials, updateTagDigest } from '@/lib/externalimage/externalimage'
import { parseImageRef, getImageDigest } from '@/lib/externalimage/registry'
import { enqueueWorkWithPriority, PRIORITY_HIGH } from '@/lib/utils/queue'

/**
 * POST /api/v1/external-image/rescan
 *
 * Trigger a rescan of an external image by image_url.
 * The rescan resets the scan status to pending and enqueues work to the
 * external_image_sbom queue with EnqueueRescanAfter=true, which causes
 * the scan to run immediately after SBOM verification.
 *
 * Request body:
 * - image_url: The image URL to rescan (e.g., "registry.example.com/org/image:tag")
 */
export async function POST(request: NextRequest) {
  try {
    // Check for Authorization header
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Authorization header required' },
        { status: 401 }
      )
    }

    // Extract Bearer token
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i)
    if (!tokenMatch) {
      return NextResponse.json(
        { error: 'Invalid authorization header format. Expected: Bearer <token>' },
        { status: 401 }
      )
    }

    const token = tokenMatch[1]

    // Authenticate the service account
    const authResult = await findServiceAccountWithValue(token)
    if (!authResult) {
      return NextResponse.json(
        { error: 'Invalid or expired service account token' },
        { status: 401 }
      )
    }

    const { teamId } = authResult

    const body = await request.json()
    const { image_url } = body

    if (!image_url) {
      return NextResponse.json(
        { error: 'image_url is required' },
        { status: 400 }
      )
    }

    // Parse the image URL to get registry/repo/tag
    const parsed = parseImageRef(image_url)

    // Get the current stored digest for this tag (validates team access)
    const storedDigest = await getExternalImageDigestForTag(
      teamId,
      parsed.registry,
      parsed.repository,
      parsed.tag
    )

    if (!storedDigest) {
      return NextResponse.json(
        { error: 'Image not found' },
        { status: 404 }
      )
    }

    // Fetch the latest digest from the registry
    // This detects if the tag has been updated to a new image
    let digest: string
    try {
      const credentials = await getExternalImageCredentials(teamId, parsed.registry, parsed.repository)
      const registryDigest = await getImageDigest(parsed, credentials ?? undefined, true)

      if (registryDigest !== storedDigest) {
        console.log(`Tag digest changed: stored=${storedDigest} registry=${registryDigest}`)
        // Update the tag's digest in the database
        await updateTagDigest(parsed.registry, parsed.repository, parsed.tag, registryDigest)
      }
      digest = registryDigest
    } catch (err) {
      // Rescan requires fetching the latest digest from the registry
      // If we can't reach the registry, fail the request
      console.error(`Failed to fetch latest digest from registry: ${err instanceof Error ? err.message : 'Unknown error'}`)
      return NextResponse.json(
        { error: `Failed to fetch latest digest from registry: ${err instanceof Error ? err.message : 'Unknown error'}` },
        { status: 502 }
      )
    }

    // Reset scan status to pending
    await resetScanStatus(digest)

    // Enqueue to external_image_sbom with high priority and EnqueueRescanAfter=true
    // High priority ensures rescans jump ahead of initial scans in the queue
    // EnqueueRescanAfter causes the handler to run scan immediately after verifying SBOM exists
    await enqueueWorkWithPriority('external_image_sbom', {
      digest: digest,
      enqueue_rescan_after: true,
    }, PRIORITY_HIGH)

    console.log(`Enqueued rescan: registry=${parsed.registry} repository=${parsed.repository} tag=${parsed.tag} digest=${digest}`)

    return NextResponse.json(
      {
        status: 202,
        message: 'Rescan request accepted and queued for processing',
        digest: digest,
      },
      { status: 202 }
    )
  } catch (error) {
    console.error('Error triggering rescan:', error)
    return NextResponse.json(
      { error: 'Failed to trigger rescan' },
      { status: 500 }
    )
  }
}
