import { upsertExternalImage } from '@/lib/externalimage/externalimage'
import { getImageDescriptor, InvalidRegistryCredentialsError, isTypedRegistryCredentials, parseImageRef, parseRegistryCredentials } from '@/lib/externalimage/registry'
import { enqueueExternalImageSBOMWork } from '@/lib/utils/queue'
import { NextRequest, NextResponse } from 'next/server'
import { findServiceAccountWithValue } from '@/lib/team/service-account'
import { getExternalImageDigestForTag, getExternalImageLastScannedAt, getExternalImagePlatforms, getExternalImageScan, getSBOMStatuses, teamOwnsDigest, EnqueueScanForDigest } from '@/lib/externalimage/externalimage'

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
    const credentials = parseRegistryCredentials(body.credentials)

    const parsed = parseImageRef(image_url)
    console.log("parsed", parsed)

    const descriptor = await getImageDescriptor(parsed, credentials)
    const { digest } = descriptor

    const typedCredentials = isTypedRegistryCredentials(credentials) ? credentials : undefined
    console.info('External image credential contract', {
      contract: typedCredentials ? 'typed' : credentials ? 'legacy' : 'anonymous',
      credential_type: typedCredentials?.type,
    })
    await upsertExternalImage(
      parsed.registry,
      parsed.repository,
      parsed.tag,
      digest,
      typedCredentials ? null : credentials?.username ?? null,
      typedCredentials ? null : credentials?.password ?? null,
      teamId,
      // Typed credentials are intentionally scoped to this pull. Do not
      // schedule a future digest check that would require reusing them.
      !typedCredentials,
    )

    if (descriptor.architectures.length === 0) {
      console.warn(`External image ${image_url} has no supported SBOM architectures; tracking it without enqueueing work`)
    }

    // Only enqueue SBOM work if needed (no existing SBOM)
    // This prevents duplicate work items and unnecessary processing
    // Note: scan_attempted_at will be set when the scan starts (SetScanStatusRunning in Go)
    await enqueueExternalImageSBOMWork({
      digest: digest,
      team_id: teamId,
    }, digest, descriptor.architectures, typedCredentials ? {
      teamId,
      registry: parsed.registry,
      imageName: parsed.repository,
      credentials: typedCredentials,
    } : undefined)

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
    if (error instanceof InvalidRegistryCredentialsError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      )
    }
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
      getSBOMStatuses(currentDigest),
    ])
    const sbomStatuses = sbomStatusResult
    const defaultSBOMStatus = sbomStatuses.find(status => status.arch === 'x86_64') ?? null

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
    // SBOM generation status is tracked separately per architecture.
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
      sbom_statuses: sbomStatuses.map(status => ({
        arch: status.arch,
        status: status.status,
        status_message: status.statusMessage,
        status_updated_at: status.statusUpdatedAt,
      })),
      // Backward compatibility: legacy scalar fields explicitly represent x86_64.
      sbom_status: defaultSBOMStatus?.status ?? null,
      sbom_status_message: defaultSBOMStatus?.statusMessage ?? null,
      sbom_status_updated_at: defaultSBOMStatus?.statusUpdatedAt ?? null,
    })
  } catch (error) {
    console.error('Error retrieving external image:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve external image' },
      { status: 500 }
    )
  }
}
