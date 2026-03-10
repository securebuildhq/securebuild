import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'
import { getLatestImageScanResult } from '@/lib/image/scan'
import { ValidationError } from '@/lib/errors/validation-error'
import { getParam } from '@/lib/data/param'

/**
 * Get scan results for an image by name, tag, and architecture
 *
 * Example:
 * curl "https://admin.sbld.io/api/image-scan?image_name=myimage&image_tag=latest&arch=x86_64" \
 *   -H "Authorization: Bearer $TOKEN"
 *
 * Required query parameters:
 * - image_name: Name of the image
 * - image_tag: Tag of the image
 * - arch: Architecture (x86_64 or aarch64)
 */
export async function GET(request: NextRequest) {
  try {
    // Get and validate session (supports both bearer token and session cookie)
    const session = await getSessionWithBearer(request, getServerSession)
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid session or bearer token required' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const imageName = searchParams.get('image_name')
    const imageTag = searchParams.get('image_tag')
    const arch = searchParams.get('arch')

    // Validate required parameters
    if (!imageName || !imageTag || !arch) {
      return NextResponse.json(
        { error: 'Missing required parameters: image_name, image_tag, and arch are required' },
        { status: 400 }
      )
    }

    // Validate architecture
    if (arch !== 'x86_64' && arch !== 'aarch64') {
      return NextResponse.json(
        { error: 'Invalid architecture. Supported values: x86_64, aarch64' },
        { status: 400 }
      )
    }

    const cve0OciHost = await getParam("CVE0_OCI_HOST")
    const fullImageName = `${cve0OciHost}/${imageName}`

    const scanResult = await getLatestImageScanResult(fullImageName, imageTag, arch)
    if (!scanResult) {
      return NextResponse.json(
        { error: 'Scan result not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(scanResult)

  } catch (error) {
    console.error('Error retrieving scan results:', error)

    // Handle validation errors
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    // Handle other errors
    return NextResponse.json(
      { error: 'Failed to retrieve scan results' },
      { status: 500 }
    )
  }
}
