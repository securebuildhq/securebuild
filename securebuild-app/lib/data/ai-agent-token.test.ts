import { 
  generateSecureToken, 
  hashToken, 
  compareToken,
  createAIAgentToken,
  validateAIAgentToken,
  createAIAgentNonce,
  validateAndConsumeNonce,
  revokeAIAgentToken,
  listAIAgentTokens
} from './ai-agent-token'
import { getDB } from './db'
import { getParam } from './param'
import bcrypt from 'bcrypt'

// Mock dependencies
jest.mock('./db')
jest.mock('./param')

describe('AI Agent Token Functions', () => {
  const mockDb = {
    query: jest.fn()
  }
  
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getDB as jest.Mock).mockReturnValue(mockDb)
    ;(getParam as jest.Mock).mockResolvedValue('postgres://test')
  })

  describe('generateSecureToken', () => {
    it('should generate a hex string of correct length', () => {
      const token8 = generateSecureToken(8)
      expect(token8).toHaveLength(16) // 8 bytes = 16 hex chars
      expect(/^[0-9a-f]+$/.test(token8)).toBe(true)
      
      const token24 = generateSecureToken(24)
      expect(token24).toHaveLength(48) // 24 bytes = 48 hex chars
      expect(/^[0-9a-f]+$/.test(token24)).toBe(true)
    })

    it('should generate unique tokens', () => {
      const token1 = generateSecureToken(8)
      const token2 = generateSecureToken(8)
      expect(token1).not.toBe(token2)
    })
  })

  describe('hashToken and compareToken', () => {
    it('should hash and compare tokens correctly', async () => {
      const plainToken = 'test-token-123'
      const hash = await hashToken(plainToken)
      
      expect(hash).toBeTruthy()
      expect(hash).not.toBe(plainToken)
      
      const isValid = await compareToken(plainToken, hash)
      expect(isValid).toBe(true)
      
      const isInvalid = await compareToken('wrong-token', hash)
      expect(isInvalid).toBe(false)
    })
  })

  describe('createAIAgentToken', () => {
    it('should create a token with correct format', async () => {
      const mockTokenRecord = {
        token_prefix: 'abcd1234abcd1234',
        buildadmin_user_id: 'user-123',
        token_hash: 'hashed-value',
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        created_at: new Date()
      }
      
      mockDb.query.mockResolvedValue({ rows: [mockTokenRecord] })
      
      const result = await createAIAgentToken('user-123', 90)
      
      expect(result.token).toMatch(/^sbai_[0-9a-f]{64}$/) // sbai_ + 16 + 48 chars
      expect(result.tokenRecord).toEqual(mockTokenRecord)
      
      // Check database call - now includes ::timestamptz casting
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ai_agent_token'),
        expect.arrayContaining([
          expect.any(String), // token_prefix
          'user-123',         // buildadmin_user_id
          expect.any(String), // token_hash
          expect.any(String), // expires_at (ISO string with ::timestamptz)
          expect.any(String)  // created_at (ISO string with ::timestamptz)
        ])
      )
    })
  })

  describe('validateAIAgentToken', () => {
    it('should validate a correct token', async () => {
      const tokenPrefix = 'abcd1234abcd1234'
      const tokenSecret = '123456789012345678901234567890123456789012345678'
      const fullToken = `sbai_${tokenPrefix}${tokenSecret}`
      const authHeader = `Bearer ${fullToken}`
      
      const mockTokenRecord = {
        token_prefix: tokenPrefix,
        buildadmin_user_id: 'user-123',
        token_hash: await bcrypt.hash(tokenSecret, 10),
        expires_at: new Date(Date.now() + 1000000)
      }
      
      mockDb.query
        .mockResolvedValueOnce({ rows: [mockTokenRecord] }) // SELECT query
        .mockResolvedValueOnce({ rows: [] }) // UPDATE query
      
      const result = await validateAIAgentToken(authHeader)
      
      expect(result).toEqual({
        tokenPrefix,
        buildadminUserId: 'user-123'
      })
      
      // Verify database queries - now includes nowUTC parameter for timestamp comparison
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM ai_agent_token'),
        [tokenPrefix, expect.any(String)] // tokenPrefix and nowUTC timestamp
      )
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ai_agent_token'),
        [tokenPrefix]
      )
    })

    it('should reject invalid auth header format', async () => {
      const result1 = await validateAIAgentToken('Bearer invalid')
      expect(result1).toBeNull()
      
      const result2 = await validateAIAgentToken('Basic sbai_token')
      expect(result2).toBeNull()
      
      const result3 = await validateAIAgentToken(null)
      expect(result3).toBeNull()
    })

    it('should reject token with invalid secret', async () => {
      const tokenPrefix = 'abcd1234abcd1234'
      const tokenSecret = 'wrong-secret-value'
      const fullToken = `sbai_${tokenPrefix}${tokenSecret}`
      const authHeader = `Bearer ${fullToken}`
      
      const mockTokenRecord = {
        token_prefix: tokenPrefix,
        buildadmin_user_id: 'user-123',
        token_hash: await bcrypt.hash('correct-secret', 10),
        expires_at: new Date(Date.now() + 1000000)
      }
      
      mockDb.query.mockResolvedValueOnce({ rows: [mockTokenRecord] })
      
      const result = await validateAIAgentToken(authHeader)
      expect(result).toBeNull()
    })

    it('should reject expired tokens', async () => {
      const tokenPrefix = 'abcd1234abcd1234'
      const tokenSecret = '123456789012345678901234567890123456789012345678'
      const fullToken = `sbai_${tokenPrefix}${tokenSecret}`
      const authHeader = `Bearer ${fullToken}`
      
      mockDb.query.mockResolvedValueOnce({ rows: [] }) // No rows = expired or not found
      
      const result = await validateAIAgentToken(authHeader)
      expect(result).toBeNull()
    })
  })

  describe('createAIAgentNonce', () => {
    it('should create a nonce with 30 second expiration', async () => {
      mockDb.query.mockResolvedValue({ rows: [] })
      
      const nonce = await createAIAgentNonce('user-123')
      
      expect(nonce).toHaveLength(64) // 32 bytes = 64 hex chars
      expect(/^[0-9a-f]+$/.test(nonce)).toBe(true)
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ai_agent_nonce'),
        expect.arrayContaining([
          expect.any(String),  // nonce
          'user-123',          // buildadmin_user_id
          expect.any(String),  // expires_at (30 seconds from now with ::timestamptz)
          expect.any(String)   // created_at (with ::timestamptz)
        ])
      )
      
      // Check expiration time is approximately 30 seconds
      const callArgs = mockDb.query.mock.calls[0][1]
      const expiresAt = new Date(callArgs[2] as string)
      const expectedExpiration = new Date(Date.now() + 30 * 1000)
      expect(Math.abs(expiresAt.getTime() - expectedExpiration.getTime())).toBeLessThan(1000)
    })
  })

  describe('validateAndConsumeNonce', () => {
    it('should validate and consume a valid nonce', async () => {
      const nonce = 'valid-nonce-123'
      const mockNonceRecord = {
        nonce,
        buildadmin_user_id: 'buildadmin-123',
        expires_at: new Date(Date.now() + 1000000)
      }
      const mockUserRecord = {
        user_id: 'user-456'
      }
      
      mockDb.query
        .mockResolvedValueOnce({ rows: [mockNonceRecord] }) // SELECT nonce
        .mockResolvedValueOnce({ rows: [] }) // DELETE nonce
        .mockResolvedValueOnce({ rows: [mockUserRecord] }) // SELECT user
      
      const result = await validateAndConsumeNonce(nonce)
      
      expect(result).toEqual({
        buildadminUserId: 'buildadmin-123',
        userId: 'user-456'
      })
      
      // Verify nonce was deleted (single use)
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ai_agent_nonce'),
        [nonce]
      )
    })

    it('should reject invalid or expired nonce', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] }) // No nonce found
      
      const result = await validateAndConsumeNonce('invalid-nonce')
      expect(result).toBeNull()
    })
  })

  describe('revokeAIAgentToken', () => {
    it('should revoke a token successfully', async () => {
      mockDb.query.mockResolvedValue({ rowCount: 1 })
      
      const result = await revokeAIAgentToken('token-prefix-123')
      
      expect(result).toBe(true)
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ai_agent_token'),
        ['token-prefix-123']
      )
    })

    it('should return false if token not found', async () => {
      mockDb.query.mockResolvedValue({ rowCount: 0 })
      
      const result = await revokeAIAgentToken('nonexistent-token')
      
      expect(result).toBe(false)
    })
  })

  describe('listAIAgentTokens', () => {
    it('should list active tokens for a user', async () => {
      const mockTokens = [
        {
          token_prefix: 'token1',
          buildadmin_user_id: 'user-123',
          expires_at: new Date(Date.now() + 1000000),
          created_at: new Date()
        },
        {
          token_prefix: 'token2',
          buildadmin_user_id: 'user-123',
          expires_at: new Date(Date.now() + 2000000),
          created_at: new Date()
        }
      ]
      
      mockDb.query.mockResolvedValue({ rows: mockTokens })
      
      const result = await listAIAgentTokens('user-123')
      
      expect(result).toEqual(mockTokens)
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM ai_agent_token'),
        ['user-123']
      )
    })
  })
})