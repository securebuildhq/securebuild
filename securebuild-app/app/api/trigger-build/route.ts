import { NextRequest, NextResponse } from 'next/server'
import { buildPackageAction } from '@/lib/package/actions/build-package'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'

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

    const { id } = body

    // Validate required fields
    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      )
    }

    // Call the server action with validated session
    const success = await buildPackageAction(id)

    return NextResponse.json({
      success: true,
      queued: success
    })

  } catch (error) {
    console.error('Error triggering build:', error)
    return NextResponse.json(
      { error: 'Failed to trigger build' },
      { status: 500 }
    )
  }
}