import { NextRequest, NextResponse } from 'next/server'
import { withdrawPackageAction } from '@/lib/package/actions/withdraw-package'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'
import { ValidationError } from '@/lib/errors/validation-error'

/**
 * Withdraw a package from the APK repository by marking it as withdrawn
 *
 * This API marks all APK catalog records with the given filename as withdrawn,
 * regardless of architecture. This effectively purges the package from the APK
 * repository. The package will no longer be available for installation.
 *
 * Example:
 * curl -X POST "https://admin.sbld.io/api/withdraw-package" \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d "{\"filename\":\"package-name-1.0.0-r0.apk\"}"
 *
 * Required parameters:
 * - filename: APK filename (e.g., "package-name-1.0.0-r0.apk")
 *
 * Returns:
 * - 200: Package successfully withdrawn
 * - 400: Invalid request (missing or invalid filename)
 * - 401: Unauthorized (missing or invalid session/bearer token)
 * - 404: No APK catalog records found for the given filename
 * - 500: Internal server error
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
    const { filename } = body

    // Validate required fields
    if (!filename?.trim()) {
      return NextResponse.json(
        { error: 'filename is required' },
        { status: 400 }
      )
    }

    // Trim filename to ensure it matches database records
    const trimmedFilename = filename.trim()

    // Call the server action with validated session
    await withdrawPackageAction(session, trimmedFilename)

    return NextResponse.json({
      success: true,
      message: `Package ${trimmedFilename} has been withdrawn from the APK repository`
    })

  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status || 400 }
      )
    }

    console.error('Error withdrawing package:', error)

    return NextResponse.json(
      { error: 'Failed to withdraw package' },
      { status: 500 }
    )
  }
}
