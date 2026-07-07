import { getBatchDigestsForTags, getBatchExternalImageScans, type ImageRefTag, getExternalImageDigestForTag, getExternalImageScan, teamOwnsDigest, BatchScanResult } from "@/lib/externalimage/externalimage"
import { parseImageRef } from "@/lib/externalimage/registry"
import { NextRequest, NextResponse } from "next/server"
import { findServiceAccountWithValue } from "@/lib/team/service-account"
import { withTrace, traceFunction } from "@/lib/observability/tracing"

export async function GET(request: NextRequest) {
  return withTrace('api.external_image.scan', async (span) => {
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

      span?.setTag('context.team_id', teamId)

      const { searchParams } = new URL(request.url)

      let digest = searchParams.get('digest')
      const imageURL = searchParams.get('image_url')
      const arch = searchParams.get('arch') || 'amd64' // Default to amd64
      const format = searchParams.get('format') || 'parsed' // Default to parsed

      if (!digest && !imageURL) {
        return NextResponse.json({ error: 'Missing digest or image_url' }, { status: 400 })
      }

      // Validate and map architecture
      let dbArch: string
      if (arch === 'amd64') {
        dbArch = 'x86_64'
      } else if (arch === 'arm64') {
        dbArch = 'aarch64'
      } else {
        return NextResponse.json({ error: 'Invalid architecture. Supported: amd64, arm64' }, { status: 400 })
      }

      // If we have an image URL, validate access and get digest
      if (imageURL) {
        const imageUrlParsed = parseImageRef(imageURL)

        try {
          digest = await getExternalImageDigestForTag(teamId, imageUrlParsed.registry, imageUrlParsed.repository, imageUrlParsed.tag)
          if (!digest) {
            return NextResponse.json(
              { error: 'Tag not found for this external image' },
              { status: 404 }
            )
          }
        } catch {
          return NextResponse.json(
            { error: 'External image not found or access denied' },
            { status: 404 }
          )
        }
      }

      if (!digest) {
        return NextResponse.json({ error: 'Digest not found' }, { status: 404 })
      }

      // Validate that the team owns this digest
      const hasAccess = await teamOwnsDigest(teamId, digest)
      if (!hasAccess) {
        return NextResponse.json({ error: 'Scan results not found' }, { status: 404 })
      }

      // Get scan results using the unified function (returns a row even for queued/running when scan_result is NULL)
      const scanData = await getExternalImageScan(digest, dbArch, format as 'raw' | 'parsed')
      if (!scanData) {
        return NextResponse.json({ error: 'Scan results not found' }, { status: 404 })
      }

      const metadata = {
        digest,
        image_digest: scanData.imageDigest,
        image_size_bytes: scanData.imageSizeBytes,
        digest_first_seen_at: scanData.digestFirstSeenAt,
        last_scanned_at: scanData.scanCreatedAt,
        updated_at: scanData.updatedAt,
        scan_status: scanData.status,
        scan_status_message: scanData.scanStatusMessage,
        scan_status_updated_at: scanData.scanStatusUpdatedAt,
        scan_attempted_at: scanData.scanAttemptedAt,
        scan_completed_at: scanData.scanCompletedAt,
      }

      // When scan result is null/empty (e.g. queued/running), return 200 with metadata only so
      // clients can read scan_status* and use this endpoint as the replacement for /scan-status.
      if (!scanData.scanResult || String(scanData.scanResult).trim() === '') {
        const emptyScan =
          format === 'parsed'
            ? { counts: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, vulnerability_details: [] }
            : { matches: [] }
        const response = NextResponse.json({ ...emptyScan, ...metadata })
        response.headers.set('X-SecureBuild-Scan_Format', format)
        response.headers.set('X-SecureBuild-Image_Digest', digest)
        response.headers.set('X-SecureBuild-Architecture', arch)
        return response
      }

      // DB may return json/jsonb as string or already-parsed object
      let scanResult: Record<string, unknown>
      try {
        scanResult =
          typeof scanData.scanResult === 'string'
            ? (JSON.parse(scanData.scanResult) as Record<string, unknown>)
            : (scanData.scanResult as Record<string, unknown>)
      } catch (error) {
        console.error('parseScanResults error:', error)
        return NextResponse.json({ error: 'Failed to parse scan results' }, { status: 500 })
      }

      // Spread the scan result at the top level and add metadata fields
      // This maintains backward compatibility - existing consumers get the
      // scan data directly while new consumers can access the additional
      // metadata fields.
      const response = NextResponse.json({
        ...scanResult,
        ...metadata,
      })

      response.headers.set('X-SecureBuild-Scan_Format', format)
      response.headers.set('X-SecureBuild-Image_Digest', digest)
      response.headers.set('X-SecureBuild-Architecture', arch)

      return response
    } catch (error) {
      console.error('Error retrieving scan results:', error)
      span?.setTag('error', error as Error)
      return NextResponse.json(
        { error: 'Failed to retrieve scan results' },
        { status: 500 }
      )
    }
  })
}

interface RequestBody {
  arch?: string;
  format?: string;
  digests?: string[];
  images?: string[];
}

type ScanResult = Record<string, unknown>;

type ResultEntry = {
  input: string
  digest: string | null
  last_scanned_at: string | null
  digest_first_seen_at: string | null
  result: ScanResult | null
  not_found: boolean
  image_size_bytes: number
  scan_status: string | null
  scan_status_message: string | null
  scan_status_updated_at: string | null
  sbom_status: string | null
  sbom_status_message: string | null
  sbom_status_updated_at: string | null
}

export async function POST(request: NextRequest) {
  return withTrace('api.external_image.scan', async (span) => {
    try {
      const authHeader = request.headers.get('Authorization')
      if (!authHeader) {
        return NextResponse.json(
          { error: 'Authorization header required' },
          { status: 401 }
        )
      }

      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i)
      if (!tokenMatch) {
        return NextResponse.json(
          { error: 'Invalid authorization header format. Expected: Bearer <token>' },
          { status: 401 }
        )
      }

      const token = tokenMatch[1]
      const authResult = await findServiceAccountWithValue(token)
      if (!authResult) {
        return NextResponse.json(
          { error: 'Invalid or expired service account token' },
          { status: 401 }
        )
      }

      const { teamId } = authResult

      span?.setTag('context.team_id', teamId)

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return NextResponse.json({ error: 'Invalid or missing JSON body' }, { status: 400 })
      }

      const requestBody = body as RequestBody;
      const arch = requestBody.arch || 'amd64'
      const format = requestBody.format || 'parsed'

      let dbArch: string
      if (arch === 'amd64') {
        dbArch = 'x86_64'
      } else if (arch === 'arm64') {
        dbArch = 'aarch64'
      } else {
        return NextResponse.json({ error: 'Invalid architecture. Supported: amd64, arm64' }, { status: 400 })
      }

      const inputDigests = Array.isArray(requestBody.digests) ? requestBody.digests : []
      const inputImages = Array.isArray(requestBody.images) ? requestBody.images : []

      span?.setTag('context.arch', dbArch)
      span?.setTag('context.digests.length', inputDigests.length)
      span?.setTag('context.images.length', inputImages.length)

      if (inputDigests.length === 0 && inputImages.length === 0) {
        return NextResponse.json({ error: 'Missing required parameters. Provide digests and/or images' }, { status: 400 })
      }

      const results = await batchListScans(teamId, inputDigests, inputImages, format as 'raw' | 'parsed', dbArch)

      const response = NextResponse.json(results)
      response.headers.set('X-SecureBuild-Architecture', arch)
      response.headers.set('X-SecureBuild-Scan_Format', format)
      response.headers.set('X-SecureBuild-Result_Count', results.length.toString())
      return response
    } catch (error) {
      console.error('Error retrieving scan results (POST):', error)
      span?.setTag('error', error as Error)
      return NextResponse.json(
        { error: 'Failed to retrieve scan results' },
        { status: 500 }
      )
    }
  })
}

const batchListScans = traceFunction('api.external_image.scan.batchListScans', async (teamId: string, inputDigests: string[], inputImages: string[], format: 'raw' | 'parsed', arch: string = 'x86_64'): Promise<ResultEntry[]> => {
  const results: ResultEntry[] = []

  if (inputDigests.length === 0 && inputImages.length === 0) {
    return results
  }

  // Step 1: Parse image URLs into ImageRefTag objects
  const imageRefTags: ImageRefTag[] = []
  for (const imageUrl of inputImages) {
    const parsed = parseImageRef(imageUrl)
    imageRefTags.push({
      registry: parsed.registry,
      repository: parsed.repository,
      tag: parsed.tag
    })
  }

  // Step 2: Get digests for all image URLs in a single query
  const imageUrlDigests = imageRefTags.length > 0
    ? await getBatchDigestsForTags(teamId, imageRefTags)
    : []

  // Step 3: Collect all digests and map inputs to digests
  const allDigests = new Set<string>()
  const inputToDigestMap = new Map<string, string | undefined>()

  // Add digests from inputDigests
  for (const digest of inputDigests) {
    allDigests.add(digest)
    inputToDigestMap.set(digest, digest)
  }

  // Add digests from image URLs
  for (const [index, imageUrl] of inputImages.entries()) {
    const digest = imageUrlDigests[index]

    inputToDigestMap.set(imageUrl, digest)

    if (digest) {
      allDigests.add(digest)
    }
  }

  // Step 4: Get scan results for all digests (team ownership validated via JOIN)
  const scanResults = allDigests.size > 0
    ? await getBatchExternalImageScans(teamId, [...allDigests], arch, format)
    : new Map<string, BatchScanResult>()

  // Step 5: Build the results array
  for (const input of [...inputDigests, ...inputImages]) {
    const digest = inputToDigestMap.get(input) || null;
    let scanData: BatchScanResult | null = null;
    if (digest) {
      scanData = scanResults.get(digest) || null;
      if (!scanData?.hasAccess) {
        scanData = null;
      }
    }

    let parsedResult: ScanResult | null = null
    if (scanData?.scanResult) {
      try {
        parsedResult = JSON.parse(scanData.scanResult)
      } catch (error) {
        console.error(`Failed to parse scan result for input ${input}:`, error)
        // Continue with null result instead of failing the entire request
      }
    }

    results.push({
      input: input,
      digest: scanData?.digest || null,
      last_scanned_at: scanData?.scanCreatedAt || null,
      digest_first_seen_at: scanData?.digestFirstSeenAt || null,
      result: parsedResult,
      not_found: scanData === null,
      image_size_bytes: scanData?.imageSizeBytes || 0,
      scan_status: scanData?.scanStatus || null,
      scan_status_message: scanData?.scanStatusMessage || null,
      scan_status_updated_at: scanData?.scanStatusUpdatedAt || null,
      sbom_status: scanData?.sbomStatus || null,
      sbom_status_message: scanData?.sbomStatusMessage || null,
      sbom_status_updated_at: scanData?.sbomStatusUpdatedAt || null,
    })
  }

  return results
},
  {
    getTags: (teamId: string, inputDigests: string[], inputImages: string[], format: 'raw' | 'parsed', arch: string = 'x86_64') => ({
      'args.team_id': teamId,
      'args.digests.length': inputDigests.length,
      'args.images.length': inputImages.length,
      'args.format': format,
      'args.arch': arch
    })
  })
