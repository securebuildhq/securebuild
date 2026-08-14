import { NextRequest, NextResponse } from 'next/server'
import { createAdditionalFileAction } from '@/lib/package/actions/create-additional-file'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'
import { ValidationError } from '@/lib/errors/validation-error'

/**
 * Create an additional file for an existing package version
 *
 * Example:
 * curl -X POST "https://admin.sbld.io/api/additional-files" \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d "{\"packageId\":\"abc123\",\"version\":\"1.0.0\",\"apkRelease\":0,\"path\":\"fix-compilation.patch\",\"content\":\"$(base64 -i fix-compilation.patch)\"}"
 *
 * Required parameters:
 * - packageId: ID of the package
 * - version: Version of the package
 * - apkRelease: APK release number
 * - path: File path (relative to build directory)
 * - content: Base64-encoded file content
 */

export async function POST(request: NextRequest) {
  try {
    // Get and validate session (supports both bearer token and session cookie)
    const session = await getSessionWithBearer(request, getServerSession)
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid session or bearer token required' },
        { status: 401 }
      )
    }

    const body = await request.json()

    const { packageId, version, apkRelease, path, content } = body

    // Validate required fields
    if (!packageId) {
      return NextResponse.json(
        { error: 'packageId is required' },
        { status: 400 }
      )
    }

    if (!version) {
      return NextResponse.json(
        { error: 'version is required' },
        { status: 400 }
      )
    }

    if (apkRelease === undefined || apkRelease === null) {
      return NextResponse.json(
        { error: 'apkRelease is required' },
        { status: 400 }
      )
    }

    if (!path) {
      return NextResponse.json(
        { error: 'path is required' },
        { status: 400 }
      )
    }

    if (!content) {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 }
      )
    }

    // Decode base64 content
    let decodedContent: string;
    try {
      decodedContent = Buffer.from(content, 'base64').toString('utf-8')
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid base64 encoding in content' },
        { status: 400 }
      )
    }

    // Call the server action with validated session
    const additionalFile = await createAdditionalFileAction(
      packageId,
      version,
      apkRelease,
      path,
      decodedContent
    )

    return NextResponse.json({
      success: true,
      additionalFile
    })

  } catch (error) {
    console.error('Error creating additional file:', error)

    // Handle validation errors
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    // Handle other errors
    return NextResponse.json(
      { error: 'Failed to create additional file' },
      { status: 500 }
    )
  }
}