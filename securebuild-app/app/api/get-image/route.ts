import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'
import { getImageByName } from '@/lib/image/image'

/**
 * Get image metadata by name
 *
 * Example:
 * curl "https://admin.sbld.io/api/get-image?image_name=myimage" \
 *   -H "Authorization: Bearer $TOKEN"
 *
 * Required query parameters:
 * - image_name: Name of the image
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionWithBearer(request, getServerSession)
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid session or bearer token required' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const imageName = searchParams.get('image_name')

    if (!imageName) {
      return NextResponse.json(
        { error: 'Missing required parameter: image_name is required' },
        { status: 400 }
      )
    }

    const image = await getImageByName(imageName)
    if (!image) {
      return NextResponse.json(
        { error: 'Image not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      id: image.id,
      name: image.name,
      alternateImage: image.alternateImage,
      readme: image.readme,
      isPublic: image.isPublic,
      createdAt: image.createdAt,
      updatedAt: image.updatedAt,
      lastScannedAt: image.lastScannedAt,
      lastBuiltAt: image.lastBuiltAt,
      lastBuildStatus: image.lastBuildStatus,
      defaultTagVulnCounts: image.defaultTagVulnCounts,
      canonicalVulnCounts: image.canonicalVulnCounts,
      fixableCVECount: image.fixableCVECount,
      externalRegistries: image.externalRegistries,
    })

  } catch (error) {
    console.error('Error retrieving image:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve image' },
      { status: 500 }
    )
  }
}
