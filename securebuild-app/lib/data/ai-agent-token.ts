import { getDB } from './db'
import { getParam } from './param'
import bcrypt from 'bcrypt'
import { randomBytes } from 'crypto'

interface AIAgentToken {
  token_prefix: string
  buildadmin_user_id: string
  token_hash: string
  expires_at: Date
  last_used_at?: Date
  created_at: Date
}

interface AIAgentNonce {
  nonce: string
  buildadmin_user_id: string
  expires_at: Date
  created_at: Date
}

export function generateSecureToken(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

export async function hashToken(token: string): Promise<string> {
  return bcrypt.hash(token, 10)
}

export async function compareToken(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(token, hash)
}

export async function createAIAgentToken(
  buildadminUserId: string,
  expiresInDays: number = 1
): Promise<{ token: string; tokenRecord: AIAgentToken }> {
  const db = getDB(await getParam("DB_URI"))
  
  const tokenPrefix = generateSecureToken(8) // 16 hex chars
  const tokenSecret = generateSecureToken(24) // 48 hex chars
  const hashedSecret = await hashToken(tokenSecret)

  // Create timestamps
  const now = new Date()
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000) // Add days
  
  const result = await db.query(
    `INSERT INTO ai_agent_token (
      token_prefix, 
      buildadmin_user_id, 
      token_hash, 
      expires_at, 
      created_at
    ) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz) 
    RETURNING *`,
    [tokenPrefix, buildadminUserId, hashedSecret, expiresAt.toISOString(), now.toISOString()]
  )

  const tokenRecord = result.rows[0] as AIAgentToken
  const fullToken = tokenPrefix + tokenSecret
  
  return {
    token: `sbai_${fullToken}`,
    tokenRecord
  }
}

export async function validateAIAgentToken(
  authHeader: string | null
): Promise<{ tokenPrefix: string; buildadminUserId: string } | null> {
  if (!authHeader?.startsWith('Bearer sbai_')) {
    return null
  }

  const fullToken = authHeader.substring('Bearer sbai_'.length)
  
  // Split token into prefix (16 chars) and secret (rest)
  if (fullToken.length < 16) {
    return null
  }
  
  const tokenPrefix = fullToken.substring(0, 16)
  const tokenSecret = fullToken.substring(16)
  
  const db = getDB(await getParam("DB_URI"))
  
  // Look up token by prefix (using UTC timestamp for comparison)
  const nowUTC = new Date().toISOString()
  const result = await db.query(
    `SELECT * FROM ai_agent_token 
     WHERE token_prefix = $1 
     AND expires_at > $2::timestamptz`,
    [tokenPrefix, nowUTC]
  )
  
  if (result.rows.length === 0) return null
  
  const dbToken = result.rows[0] as AIAgentToken
  
  // Validate secret part with bcrypt
  const isValid = await compareToken(tokenSecret, dbToken.token_hash)
  if (!isValid) return null
  
  // Update last used timestamp
  await db.query(
    `UPDATE ai_agent_token 
     SET last_used_at = NOW() 
     WHERE token_prefix = $1`,
    [tokenPrefix]
  )
  
  return {
    tokenPrefix: dbToken.token_prefix,
    buildadminUserId: dbToken.buildadmin_user_id
  }
}

export async function createAIAgentNonce(
  buildadminUserId: string
): Promise<string> {
  const db = getDB(await getParam("DB_URI"))
  const nonce = generateSecureToken(32) // 64 hex chars
  
  // Create timestamps
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 1000) // Add 30 seconds
  
  await db.query(
    `INSERT INTO ai_agent_nonce (
      nonce,
      buildadmin_user_id,
      expires_at,
      created_at
    ) VALUES ($1, $2, $3::timestamptz, $4::timestamptz)`,
    [nonce, buildadminUserId, expiresAt.toISOString(), now.toISOString()]
  )
  
  return nonce
}

export async function validateAndConsumeNonce(
  nonce: string
): Promise<{ buildadminUserId: string; userId: string } | null> {
  const db = getDB(await getParam("DB_URI"))
  
  // Get current UTC time for comparison
  const nowUTC = new Date().toISOString()
  
  // Check if nonce exists and is not expired
  const result = await db.query(
    `SELECT * FROM ai_agent_nonce 
     WHERE nonce = $1 
     AND expires_at > $2::timestamptz`,
    [nonce, nowUTC]
  )
  
  if (result.rows.length === 0) return null
  
  const nonceRecord = result.rows[0] as AIAgentNonce
  
  // Delete nonce after successful validation (single use)
  await db.query(
    `DELETE FROM ai_agent_nonce WHERE nonce = $1`,
    [nonce]
  )
  
  // Get buildadmin user context
  const userResult = await db.query(
    `SELECT bu.*, u.id as user_id
     FROM buildadmin_user bu
     JOIN securebuild_user u ON bu.email = u.email
     WHERE bu.id = $1`,
    [nonceRecord.buildadmin_user_id]
  )
  
  if (userResult.rows.length === 0) return null
  
  return {
    buildadminUserId: nonceRecord.buildadmin_user_id,
    userId: userResult.rows[0].user_id
  }
}

export async function revokeAIAgentToken(tokenPrefix: string): Promise<boolean> {
  const db = getDB(await getParam("DB_URI"))
  
  const result = await db.query(
    `DELETE FROM ai_agent_token WHERE token_prefix = $1`,
    [tokenPrefix]
  )
  
  return (result.rowCount ?? 0) > 0
}

export async function listAIAgentTokens(
  buildadminUserId: string
): Promise<AIAgentToken[]> {
  const db = getDB(await getParam("DB_URI"))
  
  const result = await db.query(
    `SELECT * FROM ai_agent_token 
     WHERE buildadmin_user_id = $1 
     AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [buildadminUserId]
  )
  
  return result.rows as AIAgentToken[]
}