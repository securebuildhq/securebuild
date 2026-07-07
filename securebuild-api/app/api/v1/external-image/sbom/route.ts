import { getExternalImageDigestForTag, getExternalImageSBOM, getBatchExternalSboms, getBatchDigestsForTags, teamOwnsDigest, type ImageRefTag, BatchSbomResult } from "@/lib/externalimage/externalimage"
import { parseImageRef } from "@/lib/externalimage/registry"
import { NextRequest, NextResponse } from "next/server"
import { findServiceAccountWithValue } from "@/lib/team/service-account"
import { mergeSBOMs } from "@/lib/sbom/merger"
import { traceFunction, withTrace } from "@/lib/observability/tracing"


export async function GET(request: NextRequest) {
  return withTrace('api.external_image.sbom', async (span) => {
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

      // Support single and multiple images using same parameter names
      const digests = searchParams.getAll('digest') // Single or multiple digests
      const imageURLs = searchParams.getAll('image_url') // Single or multiple image URLs

      span?.setTag('context.digests.length', digests.length)
      span?.setTag('context.image_urls.length', imageURLs.length)

      // Validate parameters
      const hasInputs = digests.length > 0 || imageURLs.length > 0

      if (!hasInputs) {
        return NextResponse.json({
          error: 'Missing required parameters. Provide digest and/or image_url parameters'
        }, { status: 400 })
      }

      // Handle single image (backwards compatibility)
      if (digests.length + imageURLs.length === 1) {
        return await handleSingleImage(teamId, digests[0] || null, imageURLs[0] || null)
      }

      // Handle multiple images
      return await handleMultipleImages(teamId, digests, imageURLs)
    } catch (error) {
      console.error('Error retrieving SBOM:', error)
      span?.setTag('error', error as Error)
      return NextResponse.json(
        { error: 'Failed to retrieve SBOM' },
        { status: 500 }
      )
    }
  })
}

const handleSingleImage = traceFunction('api.external_image.sbom.handleSingleImage', async (teamId: string, digestParam: string | null, imageURL: string | null): Promise<NextResponse> => {
  let digest = digestParam
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
    return NextResponse.json({ error: 'SBOM not found' }, { status: 404 })
  }

  const { sbom, source } = (await getExternalImageSBOM(digest)) || { sbom: null, source: null }

  if (!sbom) {
    return NextResponse.json({ error: 'SBOM not found' }, { status: 404 })
  }

  const response = NextResponse.json(JSON.parse(sbom))

  if (source) {
    response.headers.set('X-SecureBuild-SBOM_Source', source)
  }

  response.headers.set('X-SecureBuild-Image_Digest', digest)

  return response
},
  {
    getTags: (teamId: string, digestParam: string | null, imageURL: string | null) => ({
      'args.team_id': teamId,
      'args.digest': digestParam,
      'args.image_url': imageURL,
    })
  })

const handleMultipleImages = traceFunction('api.external_image.sbom.handleMultipleImages', async (teamId: string, inputDigests: string[], inputImages: string[]): Promise<NextResponse> => {
  const results = await batchListSboms(teamId, inputDigests, inputImages);

  const sbomStrings: string[] = []
  const sbomSources: string[] = []
  const allDigests = new Set<string>()

  for (const result of results) {
    if (!result.digest || !result.result) {
      continue
    }
    if (result.result.sbom) {
      sbomStrings.push(result.result.sbom)
      if (result.result.source) {
        sbomSources.push(result.result.source)
      }
      allDigests.add(result.digest)
    }
  }

  if (sbomStrings.length === 0) {
    return NextResponse.json({ error: 'No SBOMs found for the requested images' }, { status: 404 })
  }

  // Merge SBOMs
  let mergedSbom: string
  try {
    mergedSbom = mergeSBOMs(sbomStrings)
  } catch (error) {
    console.error('Failed to merge SBOMs:', error)
    return NextResponse.json({ error: 'Failed to merge SBOMs' }, { status: 500 })
  }

  const response = NextResponse.json(JSON.parse(mergedSbom))

  // Set headers for multiple images
  if (sbomSources.length > 0) {
    response.headers.set('X-SecureBuild-SBOM_Source', sbomSources.join(','))
  }
  response.headers.set('X-SecureBuild-Image_Count', allDigests.size.toString())
  response.headers.set('X-SecureBuild-Image_Digest', Array.from(allDigests).join(','))

  return response
},
  {
    getTags: (teamId: string, inputDigests: string[], inputImages: string[]) => ({
      'args.team_id': teamId,
      'args.digests.length': inputDigests.length,
      'args.images.length': inputImages.length,
    })
  })

type ResultEntry = {
  input: string
  digest: string | null
  result: BatchSbomResult | null
  not_found: boolean
}

const batchListSboms = traceFunction('api.external_image.sbom.batchListSboms', async (teamId: string, inputDigests: string[], inputImages: string[], arch: string = 'x86_64'): Promise<ResultEntry[]> => {
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

  // Step 4: Get SBOM results for all digests (team ownership validated via JOIN)
  const sbomResults = allDigests.size > 0
    ? await getBatchExternalSboms(teamId, [...allDigests], arch)
    : new Map<string, BatchSbomResult>()

  // Step 5: Build the results array
  for (const input of [...inputDigests, ...inputImages]) {
    const digest = inputToDigestMap.get(input) || null;
    let sbomData: BatchSbomResult | null = null;
    if (digest) {
      sbomData = sbomResults.get(digest) || null;
      if (!sbomData?.hasAccess) {
        sbomData = null;
      }
    }
    results.push({
      input: input,
      digest: digest,
      result: sbomData,
      not_found: sbomData === null,
    })
  }

  return results
},
  {
    getTags: (teamId: string, inputDigests: string[], inputImages: string[], arch: string = 'x86_64') => ({
      'args.team_id': teamId,
      'args.digests.length': inputDigests.length,
      'args.images.length': inputImages.length,
      'args.arch': arch,
    })
  })
