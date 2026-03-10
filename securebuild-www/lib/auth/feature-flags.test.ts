import { NextRequest } from 'next/server';
import {
  checkTeamFeatureFlag,
  requireFeatureFlag,
  updateTeamFeatureFlags,
  FEATURE_FLAGS,
  FeatureFlagType
} from './feature-flags';
import { findServiceAccountWithValue } from '@/lib/team/service-account';
import { getDB } from '@/lib/data/db';
import { getParam } from '@/lib/data/param';

// Mock dependencies
jest.mock('@/lib/team/service-account');
jest.mock('@/lib/data/db');
jest.mock('@/lib/data/param');

const mockFindServiceAccountWithValue = findServiceAccountWithValue as jest.MockedFunction<typeof findServiceAccountWithValue>;
const mockGetDB = getDB as jest.MockedFunction<typeof getDB>;
const mockGetParam = getParam as jest.MockedFunction<typeof getParam>;

describe('Feature Flags', () => {
  // Mock database connection
  const mockDb = {
    query: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetParam.mockResolvedValue('mock-db-uri');
    mockGetDB.mockReturnValue(mockDb as unknown as ReturnType<typeof getDB>);
  });

  describe('checkTeamFeatureFlag', () => {
    it('should return true when team has the required flag', async () => {
      const mockResult = {
        rows: [{
          feature_flags: [FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD, FEATURE_FLAGS.CUSTOM_APKO_UPLOAD]
        }]
      };
      mockDb.query.mockResolvedValue(mockResult);

      const result = await checkTeamFeatureFlag('team123', FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toBe(true);
      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT feature_flags FROM securebuild_team WHERE id = $1',
        ['team123']
      );
    });

    it('should return false when team does not have the required flag', async () => {
      const mockResult = {
        rows: [{
          feature_flags: [FEATURE_FLAGS.CUSTOM_APKO_UPLOAD]
        }]
      };
      mockDb.query.mockResolvedValue(mockResult);

      const result = await checkTeamFeatureFlag('team123', FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toBe(false);
    });

    it('should return false when team has empty feature flags array', async () => {
      const mockResult = {
        rows: [{
          feature_flags: []
        }]
      };
      mockDb.query.mockResolvedValue(mockResult);

      const result = await checkTeamFeatureFlag('team123', FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toBe(false);
    });

    it('should return false when team has null feature flags', async () => {
      const mockResult = {
        rows: [{
          feature_flags: null
        }]
      };
      mockDb.query.mockResolvedValue(mockResult);

      const result = await checkTeamFeatureFlag('team123', FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toBe(false);
    });

    it('should return false when team does not exist', async () => {
      const mockResult = {
        rows: []
      };
      mockDb.query.mockResolvedValue(mockResult);

      const result = await checkTeamFeatureFlag('nonexistent-team', FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockDb.query.mockRejectedValue(new Error('Database connection failed'));

      const result = await checkTeamFeatureFlag('team123', FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Error checking team feature flag:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should be case sensitive with flag names', async () => {
      const mockResult = {
        rows: [{
          feature_flags: ['custom_melange_upload'] // lowercase version
        }]
      };
      mockDb.query.mockResolvedValue(mockResult);

      const result = await checkTeamFeatureFlag('team123', 'CUSTOM_MELANGE_UPLOAD' as FeatureFlagType);

      expect(result).toBe(false);
    });
  });

  describe('requireFeatureFlag', () => {
    const mockServiceAccountResult = {
      serviceAccount: {
        id: 'sa123',
        name: 'Test Service Account',
        partialValue: 'abc1',
        expiresAt: new Date('2024-12-31'),
        expiresIn: '30',
        lastUsedAt: new Date(),
        createdAt: new Date()
      },
      teamId: 'team123'
    };

    function createMockRequest(authHeader?: string): NextRequest {
      const headers = new Headers();
      if (authHeader) {
        headers.set('Authorization', authHeader);
      }
      
      return new NextRequest('https://example.com/api/test', {
        headers
      });
    }

    it('should return 401 when Authorization header is missing', async () => {
      const request = createMockRequest();
      
      const result = await requireFeatureFlag(request, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toEqual({
        success: false,
        error: 'Authorization header required',
        status: 401
      });
    });

    it('should return 401 when Authorization header format is invalid', async () => {
      const request = createMockRequest('InvalidToken');
      
      const result = await requireFeatureFlag(request, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toEqual({
        success: false,
        error: 'Invalid authorization header format. Expected: Bearer <token>',
        status: 401
      });
    });

    it('should return 401 when Bearer token format is invalid', async () => {
      const request = createMockRequest('Bearer');
      
      const result = await requireFeatureFlag(request, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toEqual({
        success: false,
        error: 'Invalid authorization header format. Expected: Bearer <token>',
        status: 401
      });
    });

    it('should return 401 when service account token is invalid', async () => {
      const request = createMockRequest('Bearer invalid-token');
      mockFindServiceAccountWithValue.mockResolvedValue(null);
      
      const result = await requireFeatureFlag(request, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toEqual({
        success: false,
        error: 'Invalid or expired service account token',
        status: 401
      });
      expect(mockFindServiceAccountWithValue).toHaveBeenCalledWith('invalid-token');
    });

    it('should return 403 when team does not have required feature flag', async () => {
      const request = createMockRequest('Bearer valid-token');
      mockFindServiceAccountWithValue.mockResolvedValue(mockServiceAccountResult);
      
      const mockResult = {
        rows: [{
          feature_flags: [FEATURE_FLAGS.CUSTOM_APKO_UPLOAD]
        }]
      };
      mockDb.query.mockResolvedValue(mockResult);
      
      const result = await requireFeatureFlag(request, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toEqual({
        success: false,
        error: `Feature '${FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD}' is not enabled for your team`,
        status: 403
      });
    });

    it('should return success when team has required feature flag', async () => {
      const request = createMockRequest('Bearer valid-token');
      mockFindServiceAccountWithValue.mockResolvedValue(mockServiceAccountResult);
      
      const mockResult = {
        rows: [{
          feature_flags: [FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD]
        }]
      };
      mockDb.query.mockResolvedValue(mockResult);
      
      const result = await requireFeatureFlag(request, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toEqual({
        success: true,
        teamId: 'team123',
        serviceAccount: mockServiceAccountResult.serviceAccount
      });
    });

    it('should handle Bearer token with different case', async () => {
      const request = createMockRequest('bearer valid-token');
      mockFindServiceAccountWithValue.mockResolvedValue(mockServiceAccountResult);
      
      const mockResult = {
        rows: [{
          feature_flags: [FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD]
        }]
      };
      mockDb.query.mockResolvedValue(mockResult);
      
      const result = await requireFeatureFlag(request, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toEqual({
        success: true,
        teamId: 'team123',
        serviceAccount: mockServiceAccountResult.serviceAccount
      });
      expect(mockFindServiceAccountWithValue).toHaveBeenCalledWith('valid-token');
    });

    it('should return 401 on internal error in service account lookup', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const request = createMockRequest('Bearer valid-token');
      mockFindServiceAccountWithValue.mockRejectedValue(new Error('Service account lookup failed'));
      
      const result = await requireFeatureFlag(request, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toEqual({
        success: false,
        error: 'Internal server error',
        status: 401
      });
      expect(consoleSpy).toHaveBeenCalledWith('Error in authenticateRequest:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should return 401 on internal error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const request = createMockRequest('Bearer valid-token');
      
      // Make findServiceAccountWithValue throw an error
      mockFindServiceAccountWithValue.mockRejectedValue(new Error('Unexpected database error'));
      
      const result = await requireFeatureFlag(request, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);

      expect(result).toEqual({
        success: false,
        error: 'Internal server error',
        status: 401
      });
      expect(consoleSpy).toHaveBeenCalledWith('Error in authenticateRequest:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });
  });

  describe('updateTeamFeatureFlags', () => {
    it('should successfully update team feature flags with valid flags', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      
      const result = await updateTeamFeatureFlags('team123', [FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD]);

      expect(result).toEqual({ success: true });
      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE securebuild_team SET feature_flags = $1 WHERE id = $2',
        [[FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD], 'team123']
      );
    });

    it('should successfully update team feature flags with multiple flags', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      
      const result = await updateTeamFeatureFlags('team123', [
        FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD,
        FEATURE_FLAGS.CUSTOM_APKO_UPLOAD
      ]);

      expect(result).toEqual({ success: true });
      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE securebuild_team SET feature_flags = $1 WHERE id = $2',
        [[FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD, FEATURE_FLAGS.CUSTOM_APKO_UPLOAD], 'team123']
      );
    });

    it('should successfully update team feature flags with empty array', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      
      const result = await updateTeamFeatureFlags('team123', []);

      expect(result).toEqual({ success: true });
      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE securebuild_team SET feature_flags = $1 WHERE id = $2',
        [[], 'team123']
      );
    });

    it('should return error for invalid flag name', async () => {
      const result = await updateTeamFeatureFlags('team123', ['invalid_flag' as FeatureFlagType]);

      expect(result).toEqual({
        success: false,
        error: 'Invalid flag: invalid_flag'
      });
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should return error for mixed valid and invalid flags', async () => {
      const result = await updateTeamFeatureFlags('team123', [
        FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD,
        'invalid_flag' as FeatureFlagType
      ]);

      expect(result).toEqual({
        success: false,
        error: 'Invalid flag: invalid_flag'
      });
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should return error on database error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockDb.query.mockRejectedValue(new Error('Database update failed'));
      
      const result = await updateTeamFeatureFlags('team123', [FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD]);

      expect(result).toEqual({
        success: false,
        error: 'Failed to update feature flags'
      });
      expect(consoleSpy).toHaveBeenCalledWith('Error updating team feature flags:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should validate all flags before attempting database update', async () => {
      const result = await updateTeamFeatureFlags('team123', [
        FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD,
        'first_invalid' as FeatureFlagType,
        'second_invalid' as FeatureFlagType
      ]);

      expect(result).toEqual({
        success: false,
        error: 'Invalid flag: first_invalid'
      });
      expect(mockDb.query).not.toHaveBeenCalled();
    });
  });
});