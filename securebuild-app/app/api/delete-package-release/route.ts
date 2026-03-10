import { NextRequest, NextResponse } from 'next/server'
import { deletePackageReleaseAction } from '@/lib/package/actions/delete-package-release'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'
import { ValidationError } from '@/lib/errors/validation-error'

/**
 * Delete a package release (version + APK release)
 *
 * Example:
 * curl -X DELETE "https://admin.sbld.io/api/delete-package-release" \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d "{\"pkgId\":\"pkg_123\",\"version\":\"1.0.0\",\"apkRelease\":0}"
 *
 * Required parameters:
 * - pkgId: Package ID
 * - version: Package version
 * - apkRelease: APK release number (non-negative integer)
 */
export async function DELETE(request: NextRequest) {
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
    const { pkgId, version, apkRelease } = body

    // Validate required fields
    if (!pkgId?.trim()) {
      return NextResponse.json(
        { error: 'pkgId is required' },
        { status: 400 }
      )
    }

    if (!version?.trim()) {
      return NextResponse.json(
        { error: 'version is required' },
        { status: 400 }
      )
    }

    if (!Number.isInteger(apkRelease) || apkRelease < 0) {
      return NextResponse.json(
        { error: 'apkRelease must be a non-negative integer' },
        { status: 400 }
      )
    }

    // Call the server action with validated session
    await deletePackageReleaseAction(session, pkgId, version, apkRelease)

    return NextResponse.json({
      success: true
    })

  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      )
    }

    console.error('Error deleting package release:', error)

    return NextResponse.json(
      { error: 'Failed to delete package release' },
      { status: 500 }
    )
  }
}
