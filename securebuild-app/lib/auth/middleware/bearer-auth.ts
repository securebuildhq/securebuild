import { NextRequest } from 'next/server'
import { Session } from '@/lib/types/session'
import { User } from '@/lib/types/user'
import { validateAIAgentToken } from '@/lib/data/ai-agent-token'
import { getDB } from '@/lib/data/db'
import { getParam } from '@/lib/data/param'

export async function validateBearerToken(
  request: NextRequest
): Promise<Session | null> {
  const authHeader = request.headers.get('authorization')
  
  const tokenInfo = await validateAIAgentToken(authHeader)
  if (!tokenInfo) return null
  
  // Convert AI agent token to session format for compatibility
  const db = getDB(await getParam("DB_URI"))
  
  // Get user info from buildadmin_user
  const result = await db.query(
    `SELECT 
      bu.id as buildadmin_user_id,
      bu.email as user_email,
      u.id as user_id,
      u.email,
      u.first_name,
      u.last_name,
      u.created_at,
      u.last_login_at,
      u.last_active_at,
      bu.is_admin
     FROM buildadmin_user bu
     JOIN securebuild_user u ON bu.email = u.email
     WHERE bu.id = $1
     LIMIT 1`,
    [tokenInfo.buildadminUserId]
  )
  
  if (result.rows.length === 0) return null
  
  const userData = result.rows[0]
  
  // Create a session-compatible object
  const user: User = {
    id: userData.user_id,
    email: userData.email,
    name: `${userData.first_name} ${userData.last_name}`.trim(),
    imageUrl: '', // AI agents don't have profile images
    createdAt: new Date(userData.created_at),
    lastLoginAt: userData.last_login_at ? new Date(userData.last_login_at) : new Date(),
    lastActiveAt: userData.last_active_at ? new Date(userData.last_active_at) : new Date(),
    isAdmin: userData.is_admin
  }
  
  // Create session object with AI agent marker
  const session: Session = {
    id: `ai_agent_${tokenInfo.tokenPrefix}`, // Use token prefix as session ID
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
    user
  }
  
  return session
}

export async function getSessionWithBearer(
  request: NextRequest,
  getServerSession: () => Promise<Session | undefined>
): Promise<Session | undefined> {
  // Try bearer token first
  const bearerSession = await validateBearerToken(request)
  if (bearerSession) return bearerSession
  
  // Fall back to regular session
  return getServerSession()
}