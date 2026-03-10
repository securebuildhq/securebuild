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

const MOCK_DIGEST = 'sha256:abc123def456789012345678901234567890123456789012345678901234';

// Mock external dependencies BEFORE importing route handlers
// This prevents actual network calls and background job queueing
jest.mock('@/lib/externalimage/registry', () => {
  const actual = jest.requireActual('@/lib/externalimage/registry');
  return {
    ...actual,
    // parseImageRef is a pure function with no external dependencies, so use the real implementation
    // getImageDigest needs to be mocked to avoid network calls
    // Value is inlined here because jest.mock() is hoisted before MOCK_DIGEST is initialized
    getImageDigest: jest.fn().mockResolvedValue('sha256:abc123def456789012345678901234567890123456789012345678901234'),
  };
});

jest.mock('@/lib/utils/queue', () => ({
  enqueueWork: jest.fn().mockResolvedValue('mock-work-id'),
  hasExistingSBOM: jest.fn().mockResolvedValue(false)
}));

// Import test database setup
import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from '../../../fixtures/database';
import { createTestServiceAccount } from '../../../fixtures/auth';
import path from 'path';

import { POST, GET } from '@/app/api/v1/external-image/route';
import { POST as POST_SCAN } from '@/app/api/v1/external-image/scan/route';
import { NextRequest } from 'next/server';

// Import mocked functions for verification
import { enqueueWork } from '@/lib/utils/queue';

const MOCK_IMAGE_URL = 'fake-registry.fake-domain.com/fake-org/fake-image:latest';

/**
 * Integration tests for POST and GET /api/v1/external-image
 *
 * This test suite validates the happy path workflows:
 * - POST: Adding external images synchronously and returning 201 with digest
 * - POST: Enqueuing SBOM work for background processing
 * - GET: Retrieving external image by image_url parameter
 * - GET: Retrieving external image by sha parameter
 * - GET: Handling non-existent images (404)
 *
 * Note: POST handles the following synchronously:
 * 1. Fetches the image digest from the registry
 * 2. Creates database records (external_image, external_image_tag, external_image_team)
 * 3. Enqueues SBOM work for background processing
 */
describe('POST and GET /api/v1/external-image', () => {
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
    console.log(`Test environment ready: team=${teamId}`);
  });

  afterAll(async () => {
    // Close the pool created by getDB() for this specific test's connection string
    const { closePoolByUri } = await import("@/lib/data/db");
    await closePoolByUri(testDB.connectionString);

    await teardownTestDatabase(testDB);
  });

  beforeEach(() => {
    // Clear mock call history between tests
    jest.clearAllMocks();
  });

  describe('POST /api/v1/external-image', () => {
    it('should add external image and enqueue SBOM work', async () => {
      // Create request with proper headers and body
      const request = new NextRequest('http://localhost/api/v1/external-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_url: MOCK_IMAGE_URL
        })
      });

      // Call the POST handler directly
      const response = await POST(request);
      const data = await response.json();

      // Verify response - returns 201 Created with digest
      expect(response.status).toBe(201);
      expect(data.status).toBe(201);
      expect(data.digest).toBe(MOCK_DIGEST);
      expect(data.image_url).toBe(MOCK_IMAGE_URL);

      // Verify SBOM work was enqueued
      expect(enqueueWork).toHaveBeenCalledTimes(1);
      expect(enqueueWork).toHaveBeenCalledWith('external_image_sbom', {
        digest: MOCK_DIGEST,
      });
    });

    it('should add external image with credentials', async () => {
      // Set encryption secret for this test (required for credential storage)
      process.env.EXTERNAL_REGISTRY_ENCRYPTION_SECRET = 'test-encryption-secret-32bytes!!';

      const request = new NextRequest('http://localhost/api/v1/external-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_url: MOCK_IMAGE_URL,
          credentials: {
            username: 'testuser',
            password: 'testpass'
          }
        })
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify response - returns 201 Created with digest
      expect(response.status).toBe(201);
      expect(data.digest).toBe(MOCK_DIGEST);

      // Verify SBOM work was enqueued (credentials are stored in DB, not in queue payload)
      expect(enqueueWork).toHaveBeenCalledWith('external_image_sbom', {
        digest: MOCK_DIGEST,
      });

      // Clean up
      delete process.env.EXTERNAL_REGISTRY_ENCRYPTION_SECRET;
    });

    it('should initialize SBOM status as pending immediately after tracking new image', async () => {
      // Use a unique image URL to ensure it's a new image
      const newImageUrl = 'new-registry.example.com/new-org/new-image:v1.0.0';
      const newDigest = 'sha256:new123456789012345678901234567890123456789012345678901234567';

      // Mock getImageDigest to return our new digest
      const { getImageDigest } = jest.requireMock('@/lib/externalimage/registry');
      getImageDigest.mockResolvedValueOnce(newDigest);

      // POST to track the new image
      const postRequest = new NextRequest('http://localhost/api/v1/external-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_url: newImageUrl
        })
      });

      const postResponse = await POST(postRequest);
      const postData = await postResponse.json();

      // Verify the POST succeeded
      expect(postResponse.status).toBe(201);
      expect(postData.digest).toBe(newDigest);

      // Immediately check status via /api/v1/external-image/scan POST endpoint
      const scanRequest = new NextRequest('http://localhost/api/v1/external-image/scan', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          images: [newImageUrl],
          arch: 'amd64',
          format: 'parsed'
        })
      });

      const scanResponse = await POST_SCAN(scanRequest);
      const scanData = await scanResponse.json();

      // Verify scan endpoint response
      expect(scanResponse.status).toBe(200);
      expect(Array.isArray(scanData)).toBe(true);
      expect(scanData.length).toBe(1);

      const result = scanData[0];
      expect(result.input).toBe(newImageUrl);
      expect(result.digest).toBe(newDigest);
      expect(result.not_found).toBe(false);

      // Verify SBOM status was initialized to 'pending' immediately
      expect(result.sbom_status).toBe('pending');
      expect(result.sbom_status_message).toBeNull();
      expect(result.sbom_status_updated_at).toBeDefined();
      expect(result.sbom_status_updated_at).not.toBeNull();

      // Scan status should be null (scanning hasn't started yet - waiting for SBOM)
      expect(result.scan_status).toBeNull();
      expect(result.scan_status_message).toBeNull();
      expect(result.scan_status_updated_at).toBeNull();

      // No scan results yet
      expect(result.result).toBeNull();
      expect(result.last_scanned_at).toBeNull();
      expect(result.digest_first_seen_at).toBeNull();
      expect(result.image_size_bytes).toBe(0);
    });
  });

  describe('GET /api/v1/external-image', () => {
    // Seed test data for GET tests
    beforeAll(async () => {
      // Seed test data directly into the database
      const inFourHours = new Date(Date.now() + 1000 * 60 * 60 * 4);

      await testDB.pool.query(
        `INSERT INTO external_image (registry, image_name, created_at) VALUES ($1, $2, $3)
         ON CONFLICT (registry, image_name) DO NOTHING`,
        ['fake-registry.fake-domain.com', 'fake-org/fake-image', new Date()]
      );

      await testDB.pool.query(
        `INSERT INTO external_image_tag (registry, image_name, image_tag, created_at, digest, next_check_digest_at, next_scan_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (registry, image_name, image_tag) DO NOTHING`,
        ['fake-registry.fake-domain.com', 'fake-org/fake-image', 'latest', new Date(), MOCK_DIGEST, inFourHours, inFourHours]
      );

      await testDB.pool.query(
        `INSERT INTO external_image_team (team_id, registry, image_name, image_tag, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (team_id, registry, image_name, image_tag) DO NOTHING`,
        [teamId, 'fake-registry.fake-domain.com', 'fake-org/fake-image', 'latest', new Date()]
      );
    });

    it('should retrieve external image by image_url and sha parameters', async () => {
      // Retrieve by image_url parameter
      const getByUrlRequest = new NextRequest(
        `http://localhost/api/v1/external-image?image_url=${encodeURIComponent(MOCK_IMAGE_URL)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        }
      );

      const urlResponse = await GET(getByUrlRequest);
      const urlData = await urlResponse.json();

      // Verify response for image_url query
      expect(urlResponse.status).toBe(200);
      expect(urlData.digest).toBe(MOCK_DIGEST);
      expect(urlData.last_scanned_at).toBeDefined(); // May be null or a date
      expect(urlData.platforms).toBeDefined();
      expect(Array.isArray(urlData.platforms)).toBe(true);

      // Retrieve by sha parameter
      const getByShaRequest = new NextRequest(
        `http://localhost/api/v1/external-image?sha=${encodeURIComponent(MOCK_DIGEST)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        }
      );

      const shaResponse = await GET(getByShaRequest);
      const shaData = await shaResponse.json();

      // Verify response for sha query
      expect(shaResponse.status).toBe(200);
      expect(shaData.digest).toBe(MOCK_DIGEST);
      expect(shaData.last_scanned_at).toBeDefined();
      expect(shaData.platforms).toBeDefined();
      expect(Array.isArray(shaData.platforms)).toBe(true);

      // Verify both queries return identical results
      expect(shaData).toEqual(urlData);
    });

    it('should return 404 for non-existent image', async () => {
      const getRequest = new NextRequest(
        'http://localhost/api/v1/external-image?image_url=nonexistent:tag',
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        }
      );

      const response = await GET(getRequest);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain('not found');
    });
  });
});
