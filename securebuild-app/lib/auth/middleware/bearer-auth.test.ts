import { NextRequest } from 'next/server'
import { validateBearerToken, getSessionWithBearer } from './bearer-auth'
import { validateAIAgentToken } from '@/lib/data/ai-agent-token'
import { getDB } from '@/lib/data/db'
import { getParam } from '@/lib/data/param'
import { Session } from '@/lib/types/session'

// Mock dependencies
jest.mock('@/lib/data/ai-agent-token')
jest.mock('@/lib/data/db')
jest.mock('@/lib/data/param')

describe('Bearer Authentication Middleware', () => {
  const mockDb = {
    query: jest.fn()
  }

  const FIXED_TIMESTAMP = '2025-09-18T23:19:01.854Z'
  let originalDate: DateConstructor

  beforeEach(() => {
    jest.clearAllMocks()
    ;(getDB as jest.Mock).mockReturnValue(mockDb)
    ;(getParam as jest.Mock).mockResolvedValue('postgres://test')
    
    // Store original Date and mock it
    originalDate = global.Date
    global.Date = jest.fn(function(this: any, value?: number | string | Date) {
      if (!value) {
        return new originalDate(FIXED_TIMESTAMP)
      }
      return new originalDate(value)
    }) as any
    // Set up static methods
    global.Date.now = jest.fn(() => new Date(FIXED_TIMESTAMP).getTime())
    global.Date.parse = originalDate.parse
    global.Date.UTC = originalDate.UTC
  })

  afterEach(() => {
    // Restore original Date
    global.Date = originalDate
  })

  describe('validateBearerToken', () => {
    it('should validate a bearer token and return session', async () => {
      const mockRequest = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          'authorization': 'Bearer sbai_test-token'
        }
      })

      const mockTokenInfo = {
        tokenPrefix: 'test-prefix',
        buildadminUserId: 'buildadmin-123'
      }

      const mockUserData = {
        buildadmin_user_id: 'buildadmin-123',
        user_email: 'test@example.com',
        user_id: 'user-456',
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User',
        created_at: '2024-01-01T00:00:00Z',
        last_login_at: '2024-01-02T00:00:00Z',
        last_active_at: '2024-01-03T00:00:00Z',
        is_admin: false
      }

      ;(validateAIAgentToken as jest.Mock).mockResolvedValue(mockTokenInfo)
      mockDb.query.mockResolvedValue({ rows: [mockUserData] })

      const session = await validateBearerToken(mockRequest)

      expect(session).toBeDefined()
      expect(session?.id).toBe('ai_agent_test-prefix')
      expect(session?.user).toEqual({
        id: 'user-456',
        email: 'test@example.com',
        name: 'Test User',
        imageUrl: '',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        lastLoginAt: new Date('2024-01-02T00:00:00Z'),
        lastActiveAt: new Date('2024-01-03T00:00:00Z'),
        isAdmin: false
      })

      expect(validateAIAgentToken).toHaveBeenCalledWith('Bearer sbai_test-token')
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['buildadmin-123']
      )
    })

    it('should return null for invalid token', async () => {
      const mockRequest = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          'authorization': 'Bearer invalid-token'
        }
      })

      ;(validateAIAgentToken as jest.Mock).mockResolvedValue(null)

      const session = await validateBearerToken(mockRequest)

      expect(session).toBeNull()
      expect(mockDb.query).not.toHaveBeenCalled()
    })

    it('should return null when user not found', async () => {
      const mockRequest = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          'authorization': 'Bearer sbai_test-token'
        }
      })

      const mockTokenInfo = {
        tokenPrefix: 'test-prefix',
        buildadminUserId: 'buildadmin-123'
      }

      ;(validateAIAgentToken as jest.Mock).mockResolvedValue(mockTokenInfo)
      mockDb.query.mockResolvedValue({ rows: [] })

      const session = await validateBearerToken(mockRequest)

      expect(session).toBeNull()
    })

    it('should handle admin users correctly', async () => {
      const mockRequest = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          'authorization': 'Bearer sbai_admin-token'
        }
      })

      const mockTokenInfo = {
        tokenPrefix: 'admin-prefix',
        buildadminUserId: 'buildadmin-admin'
      }

      const mockAdminData = {
        buildadmin_user_id: 'buildadmin-admin',
        user_email: 'admin@example.com',
        user_id: 'admin-user',
        email: 'admin@example.com',
        first_name: 'Admin',
        last_name: 'User',
        created_at: '2024-01-01T00:00:00Z',
        last_login_at: null,
        last_active_at: null,
        is_admin: true
      }

      ;(validateAIAgentToken as jest.Mock).mockResolvedValue(mockTokenInfo)
      mockDb.query.mockResolvedValue({ rows: [mockAdminData] })

      const session = await validateBearerToken(mockRequest)

      expect(session?.user.isAdmin).toBe(true)
      expect(session?.user.lastLoginAt).toEqual(new Date())
      expect(session?.user.lastActiveAt).toEqual(new Date())
    })
  })

  describe('getSessionWithBearer', () => {
    it('should prefer bearer token over session', async () => {
      // Set up both a bearer token and a regular session
      const mockRequest = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          'authorization': 'Bearer sbai_test-token'
        }
      })

      // Regular session that would be returned by getServerSession
      const mockRegularSession: Session = {
        id: 'regular-session',
        expiresAt: new Date(),
        user: {
          id: 'regular-user',
          email: 'regular@example.com',
          name: 'Regular User',
          imageUrl: '',
          createdAt: new Date(),
          lastLoginAt: new Date(),
          lastActiveAt: new Date(),
          isAdmin: false
        }
      }

      // Set up bearer token validation response
      const mockTokenInfo = {
        tokenPrefix: 'test',
        buildadminUserId: 'buildadmin-123'
      }

      // Mock the user data that would be returned for the bearer token
      const mockUserData = {
        buildadmin_user_id: 'buildadmin-123',
        user_email: 'bearer@example.com',
        user_id: 'bearer-user',
        email: 'bearer@example.com',
        first_name: 'Bearer',
        last_name: 'User',
        created_at: FIXED_TIMESTAMP,
        last_login_at: FIXED_TIMESTAMP,
        last_active_at: FIXED_TIMESTAMP,
        is_admin: false
      }

      // Set up all mocks
      ;(validateAIAgentToken as jest.Mock).mockResolvedValue(mockTokenInfo)
      mockDb.query.mockResolvedValue({ rows: [mockUserData] })
      const mockGetServerSession = jest.fn().mockResolvedValue(mockRegularSession)

      // Test that bearer token session is preferred
      const session = await getSessionWithBearer(mockRequest, mockGetServerSession)

      // Verify we got the bearer token session
      expect(session?.id).toBe('ai_agent_test')
      expect(session?.user.id).toBe('bearer-user')
      expect(session?.user.email).toBe('bearer@example.com')
      
      // Verify regular session was never accessed
      expect(mockGetServerSession).not.toHaveBeenCalled()
    })

    it('should fall back to regular session when no bearer token', async () => {
      const mockRequest = new NextRequest('http://localhost:3000/api/test')

      const mockRegularSession: Session = {
        id: 'regular-session',
        expiresAt: new Date(),
        user: {
          id: 'regular-user',
          email: 'regular@example.com',
          name: 'Regular User',
          imageUrl: '',
          createdAt: new Date(),
          lastLoginAt: new Date(),
          lastActiveAt: new Date(),
          isAdmin: false
        }
      }

      ;(validateAIAgentToken as jest.Mock).mockResolvedValue(null)

      const mockGetServerSession = jest.fn().mockResolvedValue(mockRegularSession)

      const session = await getSessionWithBearer(mockRequest, mockGetServerSession)

      expect(session).toBe(mockRegularSession)
      expect(mockGetServerSession).toHaveBeenCalled()
    })

    it('should return undefined when no authentication present', async () => {
      const mockRequest = new NextRequest('http://localhost:3000/api/test')

      ;(validateAIAgentToken as jest.Mock).mockResolvedValue(null)

      const mockGetServerSession = jest.fn().mockResolvedValue(undefined)

      const session = await getSessionWithBearer(mockRequest, mockGetServerSession)

      expect(session).toBeUndefined()
    })
  })
})