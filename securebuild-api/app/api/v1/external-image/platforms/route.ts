import {
  getBatchDigestsForTags,
  getBatchExternalImagePlatformInventory,
  type ImageRefTag,
} from '@/lib/externalimage/externalimage'
import {
  parseImageRef,
  type ExternalImageArchitecture,
} from '@/lib/externalimage/registry'
import { findServiceAccountWithValue } from '@/lib/team/service-account'
import { NextRequest, NextResponse } from 'next/server'

interface RequestBody {
  digests?: string[]
  images?: string[]
}

type PlatformResult = {
  input: string
  digest: string | null
  architectures: ('amd64' | 'arm64')[]
  status: 'resolved' | 'unresolved'
  reason?: 'not_found_or_access_denied' | 'platform_metadata_unavailable'
}

function apiArchitectures(
  architectures: ExternalImageArchitecture[],
): ('amd64' | 'arm64')[] {
  return architectures.flatMap((architecture) => {
    if (architecture === 'x86_64') return ['amd64' as const]
    if (architecture === 'aarch64') return ['arm64' as const]
    return []
  })
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization')
    const tokenMatch = authHeader?.match(/^Bearer\s+(.+)$/i)
    if (!tokenMatch) {
      return NextResponse.json(
        { error: authHeader ? 'Invalid authorization header format. Expected: Bearer <token>' : 'Authorization header required' },
        { status: 401 },
      )
    }

    const authResult = await findServiceAccountWithValue(tokenMatch[1])
    if (!authResult) {
      return NextResponse.json({ error: 'Invalid or expired service account token' }, { status: 401 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid or missing JSON body' }, { status: 400 })
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 })
    }

    const requestBody = body as RequestBody
    const digests = Array.isArray(requestBody.digests) ? requestBody.digests : []
    const images = Array.isArray(requestBody.images) ? requestBody.images : []
    if (
      (digests.length === 0 && images.length === 0) ||
      digests.some((value) => typeof value !== 'string' || value.trim() === '') ||
      images.some((value) => typeof value !== 'string' || value.trim() === '')
    ) {
      return NextResponse.json(
        { error: 'Provide at least one non-empty image or digest' },
        { status: 400 },
      )
    }

    const imageRefs: ImageRefTag[] = images.map((image) => {
      const parsed = parseImageRef(image)
      return {
        registry: parsed.registry,
        repository: parsed.repository,
        tag: parsed.tag,
      }
    })
    const imageDigests = await getBatchDigestsForTags(authResult.teamId, imageRefs)
    const allDigests = [...new Set([
      ...digests,
      ...imageDigests.filter((digest): digest is string => digest !== undefined),
    ])]
    const inventory = await getBatchExternalImagePlatformInventory(authResult.teamId, allDigests)

    const buildResult = (input: string, digest: string | undefined): PlatformResult => {
      if (!digest) {
        return {
          input,
          digest: null,
          architectures: [],
          status: 'unresolved',
          reason: 'not_found_or_access_denied',
        }
      }

      const entry = inventory.get(digest)
      if (!entry?.hasAccess) {
        return {
          input,
          digest: null,
          architectures: [],
          status: 'unresolved',
          reason: 'not_found_or_access_denied',
        }
      }
      if (!entry.resolved) {
        return {
          input,
          digest,
          architectures: [],
          status: 'unresolved',
          reason: 'platform_metadata_unavailable',
        }
      }
      return {
        input,
        digest,
        architectures: apiArchitectures(entry.architectures),
        status: 'resolved',
      }
    }

    const results = [
      ...digests.map((digest) => buildResult(digest, digest)),
      ...images.map((image, index) => buildResult(image, imageDigests[index])),
    ]
    return NextResponse.json(results)
  } catch (error) {
    console.error('Error retrieving external image platforms:', error)
    return NextResponse.json({ error: 'Failed to retrieve external image platforms' }, { status: 500 })
  }
}
