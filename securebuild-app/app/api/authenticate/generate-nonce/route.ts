import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server-session'
import { createAIAgentNonce } from '@/lib/data/ai-agent-token'
import { getDB } from '@/lib/data/db'
import { getParam } from '@/lib/data/param'

export async function POST(request: NextRequest) {
  try {
    // Require user to be authenticated
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { redirectUrl } = body

    // Validate redirect URL
    if (!redirectUrl) {
      return NextResponse.json(
        { error: 'Redirect URL is required' },
        { status: 400 }
      )
    }

    try {
      const url = new URL(redirectUrl)
      // Only allow localhost for security - exact match only
      const allowedHosts = ['localhost', '127.0.0.1', '[::1]', '::1']
      if (!allowedHosts.includes(url.hostname)) {
        return NextResponse.json(
          { error: 'Only localhost redirect URLs are allowed' },
          { status: 400 }
        )
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid redirect URL format' },
        { status: 400 }
      )
    }

    // Get buildadmin_user_id for the current user
    const db = getDB(await getParam("DB_URI"))
    const result = await db.query(
      `SELECT id FROM buildadmin_user WHERE email = $1`,
      [session.user.email]
    )

    if (result.rows.length === 0) {
      // Create buildadmin_user if it doesn't exist
      const createResult = await db.query(
        `INSERT INTO buildadmin_user (id, email, name, image_url, created_at, is_admin) 
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), true) 
         RETURNING id`,
        [session.user.email, session.user.name || 'AI Agent User', session.user.imageUrl || '']
      )
      
      if (createResult.rows.length === 0) {
        throw new Error('Failed to create buildadmin user')
      }
      
      const buildadminUserId = createResult.rows[0].id
      const nonce = await createAIAgentNonce(buildadminUserId)
      
      return NextResponse.json({ nonce })
    }

    const buildadminUserId = result.rows[0].id
    
    // Generate nonce for this user
    const nonce = await createAIAgentNonce(buildadminUserId)
    
    return NextResponse.json({ nonce })
    
  } catch (error) {
    console.error('Error generating nonce:', error)
    return NextResponse.json(
      { error: 'Failed to generate authorization' },
      { status: 500 }
    )
  }
}