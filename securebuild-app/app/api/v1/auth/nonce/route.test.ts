import { POST } from './route'
import { NextRequest } from 'next/server'
import { validateAndConsumeNonce, createAIAgentToken } from '@/lib/data/ai-agent-token'

// Mock dependencies
jest.mock('@/lib/data/ai-agent-token')

describe('POST /api/v1/auth/nonce', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should exchange valid nonce for token', async () => {
    const mockNonce = 'valid-nonce-123456'
    const mockUserContext = {
      buildadminUserId: 'buildadmin-123',
      userId: 'user-456'
    }
    const mockTokenData = {
      token: 'sbai_abcd1234567890',
      tokenRecord: {
        token_prefix: 'abcd1234',
        buildadmin_user_id: 'buildadmin-123',
        token_hash: 'hashed',
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        created_at: new Date()
      }
    }

    ;(validateAndConsumeNonce as jest.Mock).mockResolvedValue(mockUserContext)
    ;(createAIAgentToken as jest.Mock).mockResolvedValue(mockTokenData)

    const request = new NextRequest('http://localhost:3000/api/v1/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ nonce: mockNonce })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      token: mockTokenData.token
    })

    expect(validateAndConsumeNonce).toHaveBeenCalledWith(mockNonce)
    expect(createAIAgentToken).toHaveBeenCalledWith('buildadmin-123', 1)
  })

  it('should reject missing nonce', async () => {
    const request = new NextRequest('http://localhost:3000/api/v1/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({})
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Invalid or missing nonce' })
    expect(validateAndConsumeNonce).not.toHaveBeenCalled()
  })

  it('should reject invalid nonce type', async () => {
    const request = new NextRequest('http://localhost:3000/api/v1/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ nonce: 123 }) // Not a string
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Invalid or missing nonce' })
    expect(validateAndConsumeNonce).not.toHaveBeenCalled()
  })

  it('should reject expired or invalid nonce', async () => {
    const mockNonce = 'expired-nonce'

    ;(validateAndConsumeNonce as jest.Mock).mockResolvedValue(null)

    const request = new NextRequest('http://localhost:3000/api/v1/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ nonce: mockNonce })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Invalid or expired nonce' })
    expect(createAIAgentToken).not.toHaveBeenCalled()
  })

  it('should handle internal errors gracefully', async () => {
    const mockNonce = 'valid-nonce'
    const mockUserContext = {
      buildadminUserId: 'buildadmin-123',
      userId: 'user-456'
    }

    ;(validateAndConsumeNonce as jest.Mock).mockResolvedValue(mockUserContext)
    ;(createAIAgentToken as jest.Mock).mockRejectedValue(new Error('Database error'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

    const request = new NextRequest('http://localhost:3000/api/v1/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ nonce: mockNonce })
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to exchange nonce for token' })
    expect(consoleSpy).toHaveBeenCalledWith(
      'Error exchanging nonce for token:',
      expect.any(Error)
    )

    consoleSpy.mockRestore()
  })
})