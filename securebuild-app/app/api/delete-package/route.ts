import { NextRequest, NextResponse } from 'next/server'
import { deletePackageAction } from '@/lib/package/actions/delete-package'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'
import { ValidationError } from '@/lib/errors/validation-error'

/**
 * Delete a package
 *
 * Example:
 * curl -X DELETE "https://admin.sbld.io/api/delete-package" \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d "{\"id\":\"pkg_123\"}"
 *
 * Required parameters:
 * - id: Package ID to delete
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
    const { id } = body

    // Validate required fields
    if (!id?.trim()) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      )
    }

    // Call the server action with validated session
    await deletePackageAction(id)

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

    console.error('Error deleting package:', error)

    return NextResponse.json(
      { error: 'Failed to delete package' },
      { status: 500 }
    )
  }
}
