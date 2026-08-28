import { getBatchDigestsForTags, getBatchExternalImageScanSummaries, type ImageRefTag, type BatchScanSummaryResult } from "@/lib/externalimage/externalimage"
import { parseImageRef } from "@/lib/externalimage/registry"
import { NextRequest, NextResponse } from "next/server"
import { findServiceAccountWithValue } from "@/lib/team/service-account"
import { traceFunction, withTrace } from "@/lib/observability/tracing"

type ImageScanResultDetails = {
  counts: SeverityCounts
}

type SeverityCounts = {
  critical: number
  high: number
  medium: number
  low: number
  total: number
}

type SummaryEntry = {
  input: string
  digest: string | null
  last_scanned_at: string | null
  digest_first_seen_at: string | null
  counts: SeverityCounts
  not_found: boolean
  image_size_bytes: number
  scan_status: string | null
  scan_status_message: string | null
  scan_status_updated_at: string | null
}

function emptyCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
}

interface RequestBody {
  digests?: string[];
  images?: string[];
}

// parsed_results already stores counts JSON in the DB

export async function POST(request: NextRequest) {
  return withTrace('api.external_image.scan_summary', async (span) => {
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

      span?.setAttribute('context.team_id', teamId)

      const { searchParams } = new URL(request.url)

      const arch = searchParams.get('arch') || 'amd64'
      let dbArch: string
      if (arch === 'amd64') {
        dbArch = 'x86_64'
      } else if (arch === 'arm64') {
        dbArch = 'aarch64'
      } else {
        return NextResponse.json({ error: 'Invalid architecture. Supported: amd64, arm64' }, { status: 400 })
      }

      // Read inputs from JSON body: { digests: string[], images: string[] }
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return NextResponse.json({ error: 'Invalid or missing JSON body' }, { status: 400 })
      }

      const requestBody = body as RequestBody;
      const inputDigests = Array.isArray(requestBody.digests) ? requestBody.digests : []
      const inputImages = Array.isArray(requestBody.images) ? requestBody.images : []

      span?.setAttribute('context.arch', dbArch)
      span?.setAttribute('context.digests.length', inputDigests.length)
      span?.setAttribute('context.images.length', inputImages.length)

      if (inputDigests.length === 0 && inputImages.length === 0) {
        return NextResponse.json({ error: 'Missing required parameters. Provide digests and/or images' }, { status: 400 })
      }

      // Use batch queries to minimize database calls
      const results = await batchListScanSummaries(teamId, inputDigests, inputImages, dbArch)

      const response = NextResponse.json(results)
      response.headers.set('X-SecureBuild-Architecture', arch)
      response.headers.set('X-SecureBuild-Result_Count', results.length.toString())
      return response
    } catch (error) {
      console.error('Error retrieving scan summaries:', error)
      span?.setAttribute('error.message', error instanceof Error ? error.message : String(error))
      return NextResponse.json(
        { error: 'Failed to retrieve scan summaries' },
        { status: 500 }
      )
    }
  })
}

const batchListScanSummaries = traceFunction('api.external_image.scan_summary.batchListScanSummaries', async (teamId: string, inputDigests: string[], inputImages: string[], arch: string = 'x86_64'): Promise<SummaryEntry[]> => {
  const results: SummaryEntry[] = []

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
    ? await getBatchExternalImageScanSummaries(teamId, [...allDigests], arch)
    : new Map<string, BatchScanSummaryResult>()

  // Step 5: Build the results array
  for (const input of [...inputDigests, ...inputImages]) {
    const digest = inputToDigestMap.get(input) || null;
    let scanData: BatchScanSummaryResult | null = null;
    if (digest) {
      scanData = scanResults.get(digest) || null;
      if (!scanData?.hasAccess) {
        scanData = null;
      }
    }

    let parsedResult: SeverityCounts | null = null
    if (scanData?.parsedResults) {
      try {
        const stored = JSON.parse(scanData.parsedResults) as SeverityCounts | ImageScanResultDetails
        parsedResult = 'counts' in stored ? stored.counts : stored
      } catch (error) {
        console.error(`Failed to parse scan result for input ${input}:`, error)
        // Continue with null result instead of failing the entire request
      }
    }

    results.push({
      input: input,
      digest: digest,
      last_scanned_at: scanData?.scanCompletedAt || null,
      digest_first_seen_at: scanData?.digestFirstSeenAt || null,
      counts: parsedResult || emptyCounts(),
      not_found: scanData === null,
      image_size_bytes: scanData?.imageSizeBytes || 0,
      scan_status: scanData?.scanStatus || null,
      scan_status_message: scanData?.scanStatusMessage || null,
      scan_status_updated_at: scanData?.scanStatusUpdatedAt || null,
    })
  }

  return results
},
  {
    getTags: (teamId: string, inputDigests: string[], inputImages: string[], arch: string = 'x86_64') => ({
      'args.team_id': teamId,
      'args.digests.length': inputDigests.length,
      'args.images.length': inputImages.length,
      'args.arch': arch
    })
  })
