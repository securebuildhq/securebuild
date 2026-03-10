import { NextRequest, NextResponse } from 'next/server'
import { listExecutionsAction } from '@/lib/execution/actions/list-executions'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'
import { ExecutionFilters } from '@/lib/execution/execution'

/**
 * List build executions with optional filtering
 *
 * Examples:
 * curl -H "Authorization: Bearer $TOKEN" "https://admin.sbld.io/api/package-executions?packageId=pkg_123"
 * curl -H "Authorization: Bearer $TOKEN" "https://admin.sbld.io/api/package-executions?status=running&limit=5"
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
    
    // Extract filters from query parameters
    const filters: ExecutionFilters = {}
    const packageId = searchParams.get('packageId')
    const status = searchParams.get('status')
    
    if (packageId) filters.packageId = packageId
    if (status) filters.status = status

    // Extract pagination parameters
    const page = searchParams.get('page')
    const limit = searchParams.get('limit')
    
    const pagination = {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined
    }

    // Call the server action with validated session
    const result = await listExecutionsAction(session, filters, pagination)

    return NextResponse.json({
      success: true,
      ...result
    })

  } catch (error) {
    console.error('Error listing executions:', error)
    return NextResponse.json(
      { error: 'Failed to list executions' },
      { status: 500 }
    )
  }
}