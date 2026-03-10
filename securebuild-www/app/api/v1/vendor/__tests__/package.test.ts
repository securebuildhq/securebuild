import { NextRequest } from 'next/server';
import { POST, GET } from '../package/route';
import { gzipSync } from 'zlib';
import * as authModule from '@/lib/auth/feature-flags';
import * as packageModule from '@/lib/custom-packages/custom-package';
import * as processorModule from '@/lib/custom-packages/melange-processor';
import * as validationModule from '@/lib/custom-packages/validation';
import * as queueModule from '@/lib/utils/queue';

// Mock all dependencies
jest.mock('@/lib/auth/feature-flags', () => ({
  authenticateRequest: jest.fn(),
  validateFeatureFlag: jest.fn(),
  FEATURE_FLAGS: {
    CUSTOM_MELANGE_UPLOAD: 'custom-melange-upload'
  },
  createAuthErrorResponse: jest.fn()
}));

jest.mock('@/lib/custom-packages/custom-package', () => ({
  createCustomPackage: jest.fn(),
  createCustomPackageVersion: jest.fn(),
  createCustomPackageAdditionalFile: jest.fn(),
  getCustomPackages: jest.fn()
}));

jest.mock('@/lib/custom-packages/melange-processor', () => ({
  decompressBase64Content: jest.fn(),
  processVendorMelange: jest.fn(),
  validateMelangeStructure: jest.fn()
}));

jest.mock('@/lib/custom-packages/validation', () => ({
  checkAllNameConflicts: jest.fn()
}));

jest.mock('@/lib/utils/queue', () => ({
  enqueueWork: jest.fn()
}));

describe('/api/v1/vendor/package', () => {
  let mockAuthenticateRequest: jest.Mock;
  let mockValidateFeatureFlag: jest.Mock;
  let mockCreateFeatureFlagErrorResponse: jest.Mock;
  let mockCreateCustomPackage: jest.Mock;
  let mockCreateCustomPackageVersion: jest.Mock;
  let mockCreateCustomPackageAdditionalFile: jest.Mock;
  let mockDecompressBase64Content: jest.Mock;
  let mockProcessVendorMelange: jest.Mock;
  let mockValidateMelangeStructure: jest.Mock;
  let mockCheckAllNameConflicts: jest.Mock;
  let mockEnqueueWork: jest.Mock;
  let mockGetCustomPackages: jest.Mock;

  beforeEach(() => {
    // Get mocked functions (imported at top of file) and cast to jest.Mock
    mockAuthenticateRequest = authModule.authenticateRequest as jest.Mock;
    mockValidateFeatureFlag = authModule.validateFeatureFlag as jest.Mock;
    mockCreateFeatureFlagErrorResponse = authModule.createAuthErrorResponse as jest.Mock;
    mockCreateCustomPackage = packageModule.createCustomPackage as jest.Mock;
    mockCreateCustomPackageVersion = packageModule.createCustomPackageVersion as jest.Mock;
    mockCreateCustomPackageAdditionalFile = packageModule.createCustomPackageAdditionalFile as jest.Mock;
    mockGetCustomPackages = packageModule.getCustomPackages as jest.Mock;
    mockDecompressBase64Content = processorModule.decompressBase64Content as jest.Mock;
    mockProcessVendorMelange = processorModule.processVendorMelange as jest.Mock;
    mockValidateMelangeStructure = processorModule.validateMelangeStructure as jest.Mock;
    mockCheckAllNameConflicts = validationModule.checkAllNameConflicts as jest.Mock;
    mockEnqueueWork = queueModule.enqueueWork as jest.Mock;

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('POST', () => {
    const createValidRequest = (body: Record<string, unknown>) => {
      return new NextRequest('http://localhost/api/v1/vendor/package', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
    };

    const setupSuccessfulAuth = () => {
      mockAuthenticateRequest.mockResolvedValue({ teamId: 'team-123' });
      mockValidateFeatureFlag.mockResolvedValue({ success: true });
    };

    const createCompressedYaml = (yamlContent: string) => {
      const compressed = gzipSync(Buffer.from(yamlContent, 'utf8'));
      return compressed.toString('base64');
    };

    it('should create custom package successfully', async () => {
      setupSuccessfulAuth();
      
      const yamlContent = `
package:
  name: test-package
  version: 1.0.0
  description: Test package
environment:
  contents:
    packages:
      - build-base
pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/example/repo
      expected-commit: abc123
`.trim();

      const requestBody = {
        melange_yaml: createCompressedYaml(yamlContent),
        use_root: false
      };

      // Setup mocks
      mockDecompressBase64Content.mockReturnValue(yamlContent);
      mockProcessVendorMelange.mockReturnValue({
        yaml: yamlContent,
        packageName: 'test-package',
        version: '1.0.0',
        allNames: ['test-package']
      });
      mockValidateMelangeStructure.mockReturnValue([]);
      mockCheckAllNameConflicts.mockResolvedValue([]);
      mockCreateCustomPackage.mockResolvedValue('cp123');
      mockCreateCustomPackageVersion.mockResolvedValue('cpv456');
      mockEnqueueWork.mockResolvedValue('build789');

      const request = createValidRequest(requestBody);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.package_id).toBe('cp123');
      expect(data.package_version_id).toBe('cpv456');
      expect(data.package_name).toBe('test-package');
      expect(data.build_id).toBe('build789');
      expect(data.status).toBe('queued');
    });

    it('should handle authentication failure', async () => {
      mockAuthenticateRequest.mockResolvedValue({ success: false, error: 'Invalid token' });
      mockCreateFeatureFlagErrorResponse.mockReturnValue(
        new Response(JSON.stringify({ error: 'Authentication failed' }), { status: 401 })
      );

      const request = createValidRequest({ melange_yaml: 'test' });
      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(mockCreateFeatureFlagErrorResponse).toHaveBeenCalledWith({ success: false, error: 'Invalid token' });
    });

    it('should handle feature flag validation failure', async () => {
      mockAuthenticateRequest.mockResolvedValue({ teamId: 'team-123' });
      mockValidateFeatureFlag.mockResolvedValue({ success: false, error: 'Feature not enabled' });
      mockCreateFeatureFlagErrorResponse.mockReturnValue(
        new Response(JSON.stringify({ error: 'Feature not enabled' }), { status: 403 })
      );

      const request = createValidRequest({ melange_yaml: 'test' });
      const response = await POST(request);

      expect(response.status).toBe(403);
      expect(mockCreateFeatureFlagErrorResponse).toHaveBeenCalledWith({ success: false, error: 'Feature not enabled' });
    });

    it('should reject missing melange_yaml', async () => {
      setupSuccessfulAuth();

      const request = createValidRequest({ use_root: false });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing or invalid "melange_yaml" field');
    });

    it('should handle decompression errors', async () => {
      setupSuccessfulAuth();
      mockDecompressBase64Content.mockImplementation(() => {
        throw new Error('Invalid compression');
      });

      const request = createValidRequest({ melange_yaml: 'invalid-base64' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Failed to decompress melange YAML');
    });

    it('should handle melange processing errors', async () => {
      setupSuccessfulAuth();
      mockDecompressBase64Content.mockReturnValue('invalid yaml');
      mockProcessVendorMelange.mockImplementation(() => {
        throw new Error('Invalid melange configuration');
      });

      const request = createValidRequest({ melange_yaml: 'valid-base64' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid melange configuration');
    });

    it('should handle structure validation errors', async () => {
      setupSuccessfulAuth();
      mockDecompressBase64Content.mockReturnValue('yaml content');
      mockProcessVendorMelange.mockReturnValue({
        yaml: 'yaml content',
        packageName: 'test',
        version: '1.0.0',
        allNames: ['test']
      });
      mockValidateMelangeStructure.mockReturnValue(['Missing package section']);

      const request = createValidRequest({ melange_yaml: 'valid-base64' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Melange structure validation failed');
    });

    it('should handle name conflicts', async () => {
      setupSuccessfulAuth();
      mockDecompressBase64Content.mockReturnValue('yaml content');
      mockProcessVendorMelange.mockReturnValue({
        yaml: 'yaml content',
        packageName: 'conflicting-package',
        version: '1.0.0',
        allNames: ['conflicting-package']
      });
      mockValidateMelangeStructure.mockReturnValue([]);
      mockCheckAllNameConflicts.mockResolvedValue([
        { name: 'conflicting-package', team_id: 'other-team', table: 'custom_package' }
      ]);

      const request = createValidRequest({ melange_yaml: 'valid-base64' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Package name conflicts');
    });

    it('should handle additional files', async () => {
      setupSuccessfulAuth();
      
      const yamlContent = 'valid yaml';
      const fileContent = 'file content';
      
      const requestBody = {
        melange_yaml: createCompressedYaml(yamlContent),
        additional_files: [
          {
            name: 'patches/fix.patch',
            data: createCompressedYaml(fileContent)
          }
        ],
        use_root: false
      };

      mockDecompressBase64Content
        .mockReturnValueOnce(yamlContent) // melange yaml
        .mockReturnValueOnce(fileContent); // additional file
      mockProcessVendorMelange.mockReturnValue({
        yaml: yamlContent,
        packageName: 'test-package',
        version: '1.0.0',
        allNames: ['test-package']
      });
      mockValidateMelangeStructure.mockReturnValue([]);
      mockCheckAllNameConflicts.mockResolvedValue([]);
      mockCreateCustomPackage.mockResolvedValue('cp123');
      mockCreateCustomPackageVersion.mockResolvedValue('cpv456');
      mockCreateCustomPackageAdditionalFile.mockResolvedValue('file789');
      mockEnqueueWork.mockResolvedValue('build789');

      const request = createValidRequest(requestBody);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(mockCreateCustomPackageAdditionalFile).toHaveBeenCalledWith(
        'cpv456',
        'patches/fix.patch',
        fileContent
      );
    });

    it('should handle invalid JSON request body', async () => {
      const request = new NextRequest('http://localhost/api/v1/vendor/package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid JSON in request body');
    });
  });

  describe('GET', () => {
    const createValidRequest = () => {
      return new NextRequest('http://localhost/api/v1/vendor/package', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token'
        }
      });
    };

    it('should list custom packages successfully', async () => {
      mockAuthenticateRequest.mockResolvedValue({ teamId: 'team-123' });
      mockValidateFeatureFlag.mockResolvedValue({ success: true });
      
      const mockDate = new Date();
      const mockPackages = [
        {
          id: 'cp1',
          name: 'package1',
          team_id: 'team-123',
          created_at: mockDate,
          is_delete_protection_enabled: false
        }
      ];

      // Expect the serialized version (as it comes back from JSON)
      const expectedPackages = [
        {
          id: 'cp1',
          name: 'package1',
          team_id: 'team-123',
          created_at: mockDate.toISOString(),
          is_delete_protection_enabled: false
        }
      ];
      
      mockGetCustomPackages.mockResolvedValue(mockPackages);

      const request = createValidRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.packages).toEqual(expectedPackages);
      expect(mockGetCustomPackages).toHaveBeenCalledWith('team-123');
    });

    it('should handle authentication failure in GET', async () => {
      mockAuthenticateRequest.mockResolvedValue({ success: false, error: 'Invalid token' });
      mockCreateFeatureFlagErrorResponse.mockReturnValue(
        new Response(JSON.stringify({ error: 'Authentication failed' }), { status: 401 })
      );

      const request = createValidRequest();
      const response = await GET(request);

      expect(response.status).toBe(401);
    });
  });
});