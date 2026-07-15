import { upsertExternalImage } from '@/lib/externalimage/externalimage'
import { getImageDigest, parseImageRef } from '@/lib/externalimage/registry'
import { enqueueWork, hasExistingSBOM } from '@/lib/utils/queue'
import { NextRequest, NextResponse } from 'next/server'
import { findServiceAccountWithValue } from '@/lib/team/service-account'
import { getExternalImageDigestForTag, getExternalImageLastScannedAt, getExternalImagePlatforms, getExternalImageScan, getSBOMStatus, teamOwnsDigest, EnqueueScanForDigest } from '@/lib/externalimage/externalimage'

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

    const { image_url, credentials } = body

    const parsed = parseImageRef(image_url)
    console.log("parsed", parsed)

    const digest = await getImageDigest(parsed, credentials)

    await upsertExternalImage(parsed.registry, parsed.repository, parsed.tag, digest, credentials?.username, credentials?.password, teamId)

    // Only enqueue SBOM work if needed (no existing SBOM)
    // This prevents duplicate work items and unnecessary processing
    // Note: scan_attempted_at will be set when the scan starts (SetScanStatusRunning in Go)
    const shouldSkipSBOM = await hasExistingSBOM(digest)
    if (!shouldSkipSBOM) {
      await enqueueWork('external_image_sbom', {
        digest: digest,
      })
    }

    return NextResponse.json(
      {
        status: 201,
        digest: digest,
        image_url: image_url,
      },
      {
        status: 201,
      }
    )
  } catch (error) {
    console.error('Error creating image:', error)
    return NextResponse.json(
      { error: 'Failed to create image' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url)

    const sha = searchParams.get('sha')
    const imageURL = searchParams.get('image_url')

    if (!sha && !imageURL) {
      return NextResponse.json({ error: 'Missing sha or image_url parameter' }, { status: 400 })
    }

    let currentDigest: string = ''

    if (sha) {
      // Validate that the team has access to this digest
      const hasAccess = await teamOwnsDigest(teamId, sha)
      if (!hasAccess) {
        return NextResponse.json(
          { error: 'Digest not found or access denied' },
          { status: 404 }
        )
      }
      currentDigest = sha
    } else if (imageURL) {
      // Get external image by name/tag
      const imageUrlParsed = parseImageRef(imageURL)
      try {
        const digest = await getExternalImageDigestForTag(teamId, imageUrlParsed.registry, imageUrlParsed.repository, imageUrlParsed.tag)
        if (!digest) {
          return NextResponse.json(
            { error: 'Tag not found for this external image' },
            { status: 404 }
          )
        }
        currentDigest = digest
      } catch {
        return NextResponse.json(
          { error: 'External image not found or access denied' },
          { status: 404 }
        )
      }
    }

    // Get last scanned time, platforms, scan status, and SBOM status
    const [lastScannedAt, platforms, amd64Scan, arm64Scan, sbomStatusResult] = await Promise.all([
      getExternalImageLastScannedAt(currentDigest),
      getExternalImagePlatforms(currentDigest),
      getExternalImageScan(currentDigest, 'x86_64', 'parsed'),
      getExternalImageScan(currentDigest, 'aarch64', 'parsed'),
      getSBOMStatus(currentDigest),
    ])
    const sbomStatus = sbomStatusResult ?? null

    // On-demand scan trigger: if the scan is stale (>4h or missing) and not
    // already queued/running, enqueue a scan via the external_image_scan channel.
    // Non-fatal: if this fails, we still return whatever scan data we have.
    let scanStartedAt: Date | null = null
    try {
      const enqueueResult = await EnqueueScanForDigest(currentDigest)
      scanStartedAt = enqueueResult.scanStartedAt
    } catch (err) {
      console.warn(`EnqueueScanForDigest failed for digest ${currentDigest}:`, err)
    }

    // Build scan statuses array from individual architecture results
    const scanStatuses = []
    if (amd64Scan) {
      scanStatuses.push({
        status: amd64Scan.status,
        scanStatusMessage: amd64Scan.scanStatusMessage,
        scanStatusUpdatedAt: amd64Scan.scanStatusUpdatedAt,
      })
    }
    if (arm64Scan) {
      scanStatuses.push({
        status: arm64Scan.status,
        scanStatusMessage: arm64Scan.scanStatusMessage,
        scanStatusUpdatedAt: arm64Scan.scanStatusUpdatedAt,
      })
    }

    // Determine overall scan status (priority: failed > running > queued > succeeded)
    // Note: SBOM generation status is tracked separately in external_image_sbom_status
    let scanStatus: string | null = null
    let scanStatusMessage: string | null = null
    let scanStatusUpdatedAt: Date | null = null

    if (scanStatuses.length > 0) {
      // Find the most relevant status based on priority
      const failed = scanStatuses.find(s => s.status === 'failed')
      const running = scanStatuses.find(s => s.status === 'running')
      const queued = scanStatuses.find(s => s.status === 'queued')
      const succeeded = scanStatuses.find(s => s.status === 'succeeded')

      if (failed) {
        scanStatus = 'failed'
        scanStatusMessage = failed.scanStatusMessage
        scanStatusUpdatedAt = failed.scanStatusUpdatedAt
      } else if (running) {
        scanStatus = 'running'
        scanStatusMessage = null
        scanStatusUpdatedAt = running.scanStatusUpdatedAt
      } else if (queued) {
        scanStatus = 'queued'
        scanStatusMessage = null
        scanStatusUpdatedAt = queued.scanStatusUpdatedAt
      } else if (succeeded) {
        scanStatus = 'succeeded'
        scanStatusMessage = null
        scanStatusUpdatedAt = succeeded.scanStatusUpdatedAt
      }
    }

    return NextResponse.json({
      digest: currentDigest,
      last_scanned_at: lastScannedAt,
      scan_started_at: scanStartedAt,
      platforms: platforms,
      scan_status: scanStatus,
      scan_status_message: scanStatusMessage,
      scan_status_updated_at: scanStatusUpdatedAt,
      sbom_status: sbomStatus?.status ?? null,
      sbom_status_message: sbomStatus?.statusMessage ?? null,
      sbom_status_updated_at: sbomStatus?.statusUpdatedAt ?? null,
    })
  } catch (error) {
    console.error('Error retrieving external image:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve external image' },
      { status: 500 }
    )
  }
}
