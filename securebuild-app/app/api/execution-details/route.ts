import { NextRequest, NextResponse } from 'next/server'
import { getExecutionAction } from '@/lib/execution/actions/get-execution'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'

/**
 * Get detailed execution information including logs
 *
 * Example:
 * curl -H "Authorization: Bearer $TOKEN" "https://admin.sbld.io/api/execution-details?id=exec_123"
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
    const id = searchParams.get('id')

    // Validate required fields
    if (!id) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      )
    }

    // Call the server action with validated session
    const execution = await getExecutionAction(session, id)

    return NextResponse.json({
      success: true,
      execution
    })

  } catch (error) {
    console.error('Error getting execution details:', error)
    return NextResponse.json(
      { error: 'Failed to get execution details' },
      { status: 500 }
    )
  }
}