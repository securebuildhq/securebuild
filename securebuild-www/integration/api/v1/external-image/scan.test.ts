// Store the test connection string for this test suite
let testConnectionString: string;

// Mock getParam to return this test's connection string
jest.mock("@/lib/data/param", () => ({
  getParam: jest.fn(async (key: string) => {
    if (key === "DB_URI" || key === "DBUri") {
      return testConnectionString;
    }
    throw new Error(`unknown param ${key}`);
  }),
  loadParams: jest.fn(),
}));

// Import test database setup
import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from '../../../fixtures/database';
import { createTestServiceAccount } from '../../../fixtures/auth';
import path from 'path';

import { GET, POST } from '@/app/api/v1/external-image/scan/route';
import { NextRequest } from 'next/server';

const MOCK_DIGEST = 'sha256:abc123def456789012345678901234567890123456789012345678901234';
const MOCK_IMAGE_URL = 'test-registry.example.com/test-org/test-image:latest';
const UNSCANNED_DIGEST = 'sha256:unscanned123456789012345678901234567890123456789012345678901';
const UNSCANNED_IMAGE_URL = 'test-registry.example.com/test-org/test-image:unscanned';
const QUEUED_DIGEST = 'sha256:queued123456789012345678901234567890123456789012345678901234';
const QUEUED_IMAGE_URL = 'test-registry.example.com/test-org/test-image:queued';
const RUNNING_DIGEST = 'sha256:running123456789012345678901234567890123456789012345678901234';
const RUNNING_IMAGE_URL = 'test-registry.example.com/test-org/test-image:running';
const FAILED_DIGEST = 'sha256:failed123456789012345678901234567890123456789012345678901234';
const FAILED_IMAGE_URL = 'test-registry.example.com/test-org/test-image:failed';
const PENDING_SBOM_DIGEST = 'sha256:pending123456789012345678901234567890123456789012345678901234';
const PENDING_SBOM_IMAGE_URL = 'test-registry.example.com/test-org/test-image:pending_sbom';
const GENERATING_SBOM_DIGEST = 'sha256:generating123456789012345678901234567890123456789012345678901';
const GENERATING_SBOM_IMAGE_URL = 'test-registry.example.com/test-org/test-image:generating_sbom';

/**
 * Integration tests for GET /api/v1/external-image/scan
 *
 * This test suite validates:
 * - GET: Retrieving scan results by digest
 * - GET: Retrieving scan results by image_url
 * - GET: Verifying descriptor field is present in parsed results
 * - GET: Handling different architectures (amd64, arm64)
 * - GET: Handling different formats (parsed, raw)
 */
describe('GET /api/v1/external-image/scan', () => {
  let testDB: TestDatabase;
  let authToken: string;
  let teamId: string;

  beforeAll(async () => {
    testDB = await setupTestDatabase();

    // Set the connection string for this test suite
    testConnectionString = testDB.connectionString;

    // Apply seed data from the seed-data directory
    const seedDataDir = path.join(__dirname, 'seed-data');
    await applySchemaHero(testDB, seedDataDir, true);

    // Use the seeded team to create a service account
    teamId = 'test-team-alpha';
    const serviceAccount = await createTestServiceAccount(testDB.pool, teamId);
    authToken = serviceAccount.token;

    console.log(`Test environment ready: team=${teamId}, digest=${MOCK_DIGEST}`);
  });

  afterAll(async () => {
    // Close the pool created by getDB() for this specific test's connection string
    const { closePoolByUri } = await import("@/lib/data/db");
    await closePoolByUri(testDB.connectionString);

    await teardownTestDatabase(testDB);
  });

  describe('GET with digest parameter', () => {
    it('should retrieve parsed scan results by digest and arch with parsed-specific fields', async () => {
      const request = new NextRequest(
        `http://localhost/api/v1/external-image/scan?digest=${encodeURIComponent(MOCK_DIGEST)}&format=parsed&arch=amd64`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        }
      );

      const response = await GET(request);
      const data = await response.json();

      // Verify response status
      expect(response.status).toBe(200);

      // Verify descriptor field exists and has correct values (parsed format only)
      expect(data.descriptor).toBeDefined();
      expect(data.descriptor.name).toBe('grype');
      expect(data.descriptor.version).toBe('0.95.0');

      // Verify counts field exists and has correct values (parsed format only)
      expect(data.counts).toBeDefined();
      expect(data.counts.high).toBe(1);
      expect(data.counts.total).toBe(1);

      // Verify fixed_counts field exists (parsed format only)
      expect(data.fixed_counts).toBeDefined();
      expect(data.created_at).toBeDefined();

      // Verify vulnerability details
      expect(data.vulnerability_details).toBeDefined();
      expect(Array.isArray(data.vulnerability_details)).toBe(true);
      expect(data.vulnerability_details.length).toBe(1);
      expect(data.vulnerability_details[0].cve).toBe('CVE-2025-9086');

      // Verify new metadata fields
      expect(data.digest).toBe(MOCK_DIGEST);
      expect(data.last_scanned_at).toBeDefined();
      expect(data.digest_first_seen_at).toBeDefined();
      expect(data.image_size_bytes).toBeGreaterThanOrEqual(0);
      expect(data.scan_status).toBeDefined();
      expect(data.scan_status_message).toBeDefined();
      expect(data.scan_status_updated_at).toBeDefined();
      expect(data.scan_attempted_at).toBeDefined();
      expect(data.scan_completed_at).toBeDefined();
      expect(data.updated_at).toBeDefined();
      expect(data.image_digest).toBeDefined();

      // Verify response headers
      expect(response.headers.get('X-SecureBuild-Scan_Format')).toBe('parsed');
      expect(response.headers.get('X-SecureBuild-Image_Digest')).toBe(MOCK_DIGEST);
      expect(response.headers.get('X-SecureBuild-Architecture')).toBe('amd64');
    });

    it('should retrieve scan results for arm64 architecture', async () => {
      const request = new NextRequest(
        `http://localhost/api/v1/external-image/scan?digest=${encodeURIComponent(MOCK_DIGEST)}&arch=arm64`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        }
      );

      const response = await GET(request);
      const data = await response.json();

      // Verify response status
      expect(response.status).toBe(200);

      // Verify descriptor field exists
      expect(data.descriptor).toBeDefined();
      expect(data.descriptor.name).toBe('grype');
      expect(data.descriptor.version).toBe('0.95.0');

      // Verify new metadata fields
      expect(data.digest).toBe(MOCK_DIGEST);
      expect(data.scan_status).toBeDefined();
      expect(data.last_scanned_at).toBeDefined();

      // Verify architecture header
      expect(response.headers.get('X-SecureBuild-Architecture')).toBe('arm64');
    });
  });

  describe('GET with image_url parameter', () => {
    it('should retrieve raw scan results by image_url and arch with raw-specific fields', async () => {
      const request = new NextRequest(
        `http://localhost/api/v1/external-image/scan?image_url=${encodeURIComponent(MOCK_IMAGE_URL)}&format=raw&arch=amd64`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        }
      );

      const response = await GET(request);
      const data = await response.json();

      // Verify response status
      expect(response.status).toBe(200);

      // Verify descriptor field exists and has correct values
      expect(data.descriptor).toBeDefined();
      expect(data.descriptor.name).toBe('grype');
      expect(data.descriptor.version).toBe('0.95.0');

      // Verify matches field exists (raw format only)
      expect(data.matches).toBeDefined();
      expect(Array.isArray(data.matches)).toBe(true);

      // Verify new metadata fields
      expect(data.digest).toBe(MOCK_DIGEST);
      expect(data.last_scanned_at).toBeDefined();
      expect(data.digest_first_seen_at).toBeDefined();
      expect(data.image_size_bytes).toBeGreaterThanOrEqual(0);
      expect(data.scan_status).toBeDefined();
      expect(data.scan_status_message).toBeDefined();
      expect(data.scan_status_updated_at).toBeDefined();
      expect(data.scan_attempted_at).toBeDefined();
      expect(data.scan_completed_at).toBeDefined();
      expect(data.updated_at).toBeDefined();
      expect(data.image_digest).toBeDefined();

      // Verify format header
      expect(response.headers.get('X-SecureBuild-Scan_Format')).toBe('raw');
      expect(response.headers.get('X-SecureBuild-Architecture')).toBe('amd64');
    });
  });

  describe('GET when scan is queued or running (no scan result yet)', () => {
    it('should return 200 with scan_status metadata for queued scan', async () => {
      const request = new NextRequest(
        `http://localhost/api/v1/external-image/scan?digest=${encodeURIComponent(QUEUED_DIGEST)}&format=parsed&arch=amd64`,
        {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${authToken}` },
        }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.digest).toBe(QUEUED_DIGEST);
      expect(data.scan_status).toBe('queued');
      expect(data.scan_status_message).toBeDefined();
      expect(data.scan_status_updated_at).toBeDefined();
      expect(data.counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0, total: 0 });
      expect(data.vulnerability_details).toEqual([]);
      expect(response.headers.get('X-SecureBuild-Image_Digest')).toBe(QUEUED_DIGEST);
    });

    it('should return 200 with scan_status metadata for running scan', async () => {
      const request = new NextRequest(
        `http://localhost/api/v1/external-image/scan?digest=${encodeURIComponent(RUNNING_DIGEST)}&format=parsed&arch=amd64`,
        {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${authToken}` },
        }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.digest).toBe(RUNNING_DIGEST);
      expect(data.scan_status).toBe('running');
      expect(data.matches).toBeUndefined();
      expect(data.counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0, total: 0 });
      expect(data.vulnerability_details).toEqual([]);
    });
  });

  describe('POST with batch digests and images', () => {
    it('should retrieve scan results for multiple digests with scan status fields', async () => {
      const request = new NextRequest(
        'http://localhost/api/v1/external-image/scan',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            digests: [MOCK_DIGEST],
            arch: 'amd64',
            format: 'parsed'
          })
        }
      );

      const response = await POST(request);
      const data = await response.json();

      // Verify response status
      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);

      // Verify result structure
      const result = data[0];
      expect(result.input).toBe(MOCK_DIGEST);
      expect(result.digest).toBe(MOCK_DIGEST);
      expect(result.last_scanned_at).toBeDefined();
      expect(result.digest_first_seen_at).toBeDefined();
      expect(result.not_found).toBe(false);
      expect(result.image_size_bytes).toBeGreaterThanOrEqual(0);

      // Verify scan status fields are present
      expect(result.scan_status).toBeDefined();
      expect(result.scan_status_message).toBeDefined();
      expect(result.scan_status_updated_at).toBeDefined();

      // Verify scan result contains expected fields
      expect(result.result).toBeDefined();
      expect(result.result.descriptor).toBeDefined();
      expect(result.result.descriptor.name).toBe('grype');
      expect(result.result.counts).toBeDefined();

      // Verify response headers
      expect(response.headers.get('X-SecureBuild-Architecture')).toBe('amd64');
      expect(response.headers.get('X-SecureBuild-Scan_Format')).toBe('parsed');
      expect(response.headers.get('X-SecureBuild-Result_Count')).toBe('1');
    });

    it('should retrieve scan results for image URLs with scan status fields', async () => {
      const request = new NextRequest(
        'http://localhost/api/v1/external-image/scan',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            images: [MOCK_IMAGE_URL],
            arch: 'arm64',
            format: 'parsed'
          })
        }
      );

      const response = await POST(request);
      const data = await response.json();

      // Verify response status
      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);

      // Verify result structure
      const result = data[0];
      expect(result.input).toBe(MOCK_IMAGE_URL);
      expect(result.digest).toBe(MOCK_DIGEST);
      expect(result.not_found).toBe(false);

      // Verify scan status fields are present
      expect(result.scan_status).toBeDefined();
      expect(result.scan_status_message).toBeDefined();
      expect(result.scan_status_updated_at).toBeDefined();

      // Verify response headers
      expect(response.headers.get('X-SecureBuild-Architecture')).toBe('arm64');
    });

    it('should handle mixed digests and images with scan status fields', async () => {
      const request = new NextRequest(
        'http://localhost/api/v1/external-image/scan',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            digests: [MOCK_DIGEST],
            images: [MOCK_IMAGE_URL],
            arch: 'amd64',
            format: 'parsed'
          })
        }
      );

      const response = await POST(request);
      const data = await response.json();

      // Verify response status
      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);

      // Verify both results have scan status fields
      for (const result of data) {
        expect(result.scan_status).toBeDefined();
        expect(result.scan_status_message).toBeDefined();
        expect(result.scan_status_updated_at).toBeDefined();
      }

      // Verify response headers
      expect(response.headers.get('X-SecureBuild-Result_Count')).toBe('2');
    });

    it('should handle not-found images with null scan status fields', async () => {
      const notFoundDigest = 'sha256:notfound123456789012345678901234567890123456789012345678901234';
      const notFoundImageUrl = 'test-registry.example.com/not-found/image:missing';

      const request = new NextRequest(
        'http://localhost/api/v1/external-image/scan',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            digests: [notFoundDigest],
            images: [notFoundImageUrl],
            arch: 'amd64',
            format: 'parsed'
          })
        }
      );

      const response = await POST(request);
      const data = await response.json();

      // Verify response status
      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);

      // Verify both not-found results
      for (const result of data) {
        expect(result.not_found).toBe(true);
        expect(result.digest).toBeNull();
        expect(result.result).toBeNull();
        expect(result.last_scanned_at).toBeNull();
        expect(result.digest_first_seen_at).toBeNull();
        expect(result.image_size_bytes).toBe(0);

        // Verify scan status fields are null for not-found images
        expect(result.scan_status).toBeNull();
        expect(result.scan_status_message).toBeNull();
        expect(result.scan_status_updated_at).toBeNull();
      }

      // Verify inputs are preserved
      expect(data[0].input).toBe(notFoundDigest);
      expect(data[1].input).toBe(notFoundImageUrl);
    });

    it('should handle found but unscanned images with null scan status fields', async () => {
      const request = new NextRequest(
        'http://localhost/api/v1/external-image/scan',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            digests: [UNSCANNED_DIGEST],
            images: [UNSCANNED_IMAGE_URL],
            arch: 'amd64',
            format: 'parsed'
          })
        }
      );

      const response = await POST(request);
      const data = await response.json();

      // Verify response status
      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);

      // Verify both unscanned results
      for (const result of data) {
        // not_found is true because scan data doesn't exist (even though the image tag exists)
        expect(result.not_found).toBe(true);

        // Digest should be null because no scan data exists
        expect(result.digest).toBeNull();

        // Scan data should not exist yet
        expect(result.result).toBeNull();
        expect(result.last_scanned_at).toBeNull();
        expect(result.digest_first_seen_at).toBeNull();

        // Image size should be 0 (no scan data yet)
        expect(result.image_size_bytes).toBe(0);

        // Verify scan status fields are null for unscanned images
        expect(result.scan_status).toBeNull();
        expect(result.scan_status_message).toBeNull();
        expect(result.scan_status_updated_at).toBeNull();
      }

      // Verify inputs are preserved
      expect(data[0].input).toBe(UNSCANNED_DIGEST);
      expect(data[1].input).toBe(UNSCANNED_IMAGE_URL);
    });

    it('should return succeeded scan status for completed scans', async () => {
      const request = new NextRequest(
        'http://localhost/api/v1/external-image/scan',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            digests: [MOCK_DIGEST],
            arch: 'amd64',
            format: 'parsed'
          })
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.length).toBe(1);

      const result = data[0];
      expect(result.not_found).toBe(false);
      expect(result.digest).toBe(MOCK_DIGEST);
      expect(result.result).toBeDefined();

      // Verify succeeded status
      expect(result.scan_status).toBe('succeeded');
      expect(result.scan_status_message).toBeNull();
      // Timestamp should be defined (exact format varies due to timezone conversion)
      expect(result.scan_status_updated_at).toBeDefined();
      expect(result.scan_status_updated_at).not.toBeNull();
    });

    it('should return queued scan status', async () => {
      const request = new NextRequest(
        'http://localhost/api/v1/external-image/scan',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            images: [QUEUED_IMAGE_URL],
            arch: 'amd64',
            format: 'parsed'
          })
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.length).toBe(1);

      const result = data[0];
      expect(result.not_found).toBe(false);
      expect(result.digest).toBe(QUEUED_DIGEST);
      expect(result.result).toBeNull(); // No scan results yet

      // Verify queued status
      expect(result.scan_status).toBe('queued');
      expect(result.scan_status_message).toBeNull();
      expect(result.scan_status_updated_at).toBeDefined();
      expect(result.scan_status_updated_at).not.toBeNull();
    });

    it('should return running scan status', async () => {
      const request = new NextRequest(
        'http://localhost/api/v1/external-image/scan',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            digests: [RUNNING_DIGEST],
            arch: 'amd64',
            format: 'parsed'
          })
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.length).toBe(1);

      const result = data[0];
      expect(result.not_found).toBe(false);
      expect(result.digest).toBe(RUNNING_DIGEST);
      expect(result.result).toBeNull(); // No scan results yet

      // Verify running status
      expect(result.scan_status).toBe('running');
      expect(result.scan_status_message).toBeNull();
      expect(result.scan_status_updated_at).toBeDefined();
      expect(result.scan_status_updated_at).not.toBeNull();
    });

    it('should return failed scan status with error message', async () => {
      const request = new NextRequest(
        'http://localhost/api/v1/external-image/scan',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            images: [FAILED_IMAGE_URL],
            arch: 'amd64',
            format: 'parsed'
          })
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.length).toBe(1);

      const result = data[0];
      expect(result.not_found).toBe(false);
      expect(result.digest).toBe(FAILED_DIGEST);
      expect(result.result).toBeNull(); // No scan results on failure

      // Verify failed status with message
      expect(result.scan_status).toBe('failed');
      expect(result.scan_status_message).toBe('Failed to pull image: authentication required');
      expect(result.scan_status_updated_at).toBeDefined();
      expect(result.scan_status_updated_at).not.toBeNull();
    });

    it('should return pending SBOM status with null scan status', async () => {
      // Test that images with pending SBOM status (tracked in external_image_sbom_status)
      // return sbom_status='pending' and scan_status=null since scanning can't start until SBOM is ready
      const request = new NextRequest(
        'http://localhost/api/v1/external-image/scan',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            images: [PENDING_SBOM_IMAGE_URL],
            arch: 'amd64',
            format: 'parsed'
          })
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.length).toBe(1);

      const result = data[0];
      expect(result.not_found).toBe(false);
      expect(result.digest).toBe(PENDING_SBOM_DIGEST);
      expect(result.result).toBeNull(); // No scan results yet

      // SBOM status should be 'pending'
      expect(result.sbom_status).toBe('pending');
      expect(result.sbom_status_message).toBeNull();
      expect(result.sbom_status_updated_at).toBeDefined();
      expect(result.sbom_status_updated_at).not.toBeNull();

      // Scan hasn't started yet (waiting for SBOM)
      expect(result.scan_status).toBeNull();
      expect(result.scan_status_message).toBeNull();
      expect(result.scan_status_updated_at).toBeNull();

      // SBOM hasn't been generated yet, so these should be null/0
      expect(result.digest_first_seen_at).toBeNull();
      expect(result.image_size_bytes).toBe(0);
    });

    it('should return generating SBOM status with null scan status', async () => {
      // Test that images with generating SBOM status (tracked in external_image_sbom_status)
      // return sbom_status='generating' and scan_status=null since scanning can't start until SBOM generation completes
      const request = new NextRequest(
        'http://localhost/api/v1/external-image/scan',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            digests: [GENERATING_SBOM_DIGEST],
            arch: 'amd64',
            format: 'parsed'
          })
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.length).toBe(1);

      const result = data[0];
      expect(result.not_found).toBe(false);
      expect(result.digest).toBe(GENERATING_SBOM_DIGEST);
      expect(result.result).toBeNull(); // No scan results yet

      // SBOM status should be 'generating'
      expect(result.sbom_status).toBe('generating');
      expect(result.sbom_status_message).toBeNull();
      expect(result.sbom_status_updated_at).toBeDefined();
      expect(result.sbom_status_updated_at).not.toBeNull();

      // Scan hasn't started yet (waiting for SBOM to complete)
      expect(result.scan_status).toBeNull();
      expect(result.scan_status_message).toBeNull();
      expect(result.scan_status_updated_at).toBeNull();

      // SBOM is still being generated, so these should be null/0
      expect(result.digest_first_seen_at).toBeNull();
      expect(result.image_size_bytes).toBe(0);
    });
  });

});
