import { NextRequest, NextResponse } from 'next/server'
import { getPackageAction } from '@/lib/package/actions/get-package'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'

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
    const packageData = await getPackageAction(session, id)

    return NextResponse.json({
      success: true,
      package: packageData
    })

  } catch (error) {
    console.error('Error getting package details:', error)
    return NextResponse.json(
      { error: 'Failed to get package details' },
      { status: 500 }
    )
  }
}