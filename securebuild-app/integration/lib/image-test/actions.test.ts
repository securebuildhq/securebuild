/**
 * Integration tests for image-test API routes
 * Tests POST/GET/DELETE operations for image test YAML configurations
 */

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

// Mock queue to track github_sync enqueuing
jest.mock('@/lib/utils/queue', () => ({
  enqueueWork: jest.fn().mockResolvedValue('mock-work-id')
}));

// Mock next/cache revalidatePath (used by server actions)
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn()
}));

// Mock bearer auth - default returns a test session, can be overridden per test
const mockGetSessionWithBearer = jest.fn();
jest.mock('@/lib/auth/middleware/bearer-auth', () => ({
  getSessionWithBearer: mockGetSessionWithBearer
}));

jest.mock('@/lib/auth/server-session', () => ({
  getServerSession: jest.fn().mockResolvedValue({
    id: 'test-session-id',
    expiresAt: new Date('2099-01-01T00:00:00Z'),
    user: { id: 'test-user-id' },
  }),
}));

// Helper to set up authenticated session mock
function mockAuthenticatedSession() {
  mockGetSessionWithBearer.mockResolvedValue({
    id: 'test-session-id',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User',
      imageUrl: '',
      createdAt: new Date(),
      lastLoginAt: new Date(),
      lastActiveAt: new Date(),
      isAdmin: false
    }
  });
}

// Helper to set up unauthenticated mock
function mockUnauthenticatedSession() {
  mockGetSessionWithBearer.mockResolvedValue(null);
}

import path from 'path';
import { NextRequest } from 'next/server';
import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from '../../fixtures/database';
import { GET, POST, DELETE } from '@/app/api/image-test/route';
import { setImageTestAction, deleteImageTestAction } from '@/lib/image/actions/set-image-test';
import { enqueueWork } from '@/lib/utils/queue';

const MOCK_TEST_YAML = `referenceImage: bitnami/kubectl:1.33.4
test:
  pipeline:
    - name: inspect-images
      runs: |
        docker inspect \${{ourImage}}
        docker inspect \${{refImage}}
        echo "Architecture: \${{arch}}"
    - name: compare-images
      uses: test/compare-images
      with:
        threshold: "10"
        format: "json"
`;

describe('Image Test API Integration Tests', () => {
  let testDB: TestDatabase;
  const apkoId = 'apko01234567890abcdef123456';
  const versionId = 'apkov01234567890abcdef12345';

  beforeAll(async () => {
    testDB = await setupTestDatabase();
    testConnectionString = testDB.connectionString;

    // Apply seed data for images, apko, apko_version
    const seedDataDir = path.join(__dirname, 'seed-data');
    await applySchemaHero(testDB, seedDataDir, true);

    console.log(`Test environment ready: connection=${testConnectionString.substring(0, 30)}...`);
  }, 60000);

  afterAll(async () => {
    const { closePoolByUri } = await import("@/lib/data/db");
    await closePoolByUri(testDB.connectionString);

    await teardownTestDatabase(testDB);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default to authenticated session for most tests
    mockAuthenticatedSession();
  });

  /**
   * Happy path: POST to create, GET to retrieve, DELETE to remove
   */
  it('should create, retrieve, and delete image test via API', async () => {
    // POST: Create image test
    const postRequest = new NextRequest('http://localhost/api/image-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apkoId,
        apkoVersionId: versionId,
        testYaml: MOCK_TEST_YAML,
        description: 'Test description'
      })
    });

    const postResponse = await POST(postRequest);
    const postData = await postResponse.json();

    expect(postResponse.status).toBe(200);
    expect(postData.success).toBe(true);

    // GET: Retrieve the created test
    const getRequest = new NextRequest(
      `http://localhost/api/image-test?apko_id=${apkoId}&apko_version_id=${versionId}`,
      { method: 'GET' }
    );

    const getResponse = await GET(getRequest);
    const getData = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getData.testYaml).toContain('referenceImage: bitnami/kubectl:1.33.4');
    expect(getData.testYaml).toContain('inspect-images');
    expect(getData.testYaml).toContain('compare-images');

    // DELETE: Remove the test
    const deleteRequest = new NextRequest('http://localhost/api/image-test', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apkoId, apkoVersionId: versionId })
    });

    const deleteResponse = await DELETE(deleteRequest);
    const deleteData = await deleteResponse.json();

    expect(deleteResponse.status).toBe(200);
    expect(deleteData.success).toBe(true);

    // Verify deletion via GET
    const verifyRequest = new NextRequest(
      `http://localhost/api/image-test?apko_id=${apkoId}&apko_version_id=${versionId}`,
      { method: 'GET' }
    );

    const verifyResponse = await GET(verifyRequest);
    const verifyData = await verifyResponse.json();

    expect(verifyResponse.status).toBe(200);
    expect(verifyData.testYaml).toBeNull();
  }, 30000);

  /**
   * Auth validation: unauthenticated requests should return 401
   */
  it('should return 401 for unauthenticated requests', async () => {
    mockUnauthenticatedSession();

    // Test POST without auth
    const postRequest = new NextRequest('http://localhost/api/image-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apkoId,
        apkoVersionId: versionId,
        testYaml: MOCK_TEST_YAML,
        description: 'Test description'
      })
    });

    const postResponse = await POST(postRequest);
    expect(postResponse.status).toBe(401);

    // Test GET without auth
    const getRequest = new NextRequest(
      `http://localhost/api/image-test?apko_id=${apkoId}&apko_version_id=${versionId}`,
      { method: 'GET' }
    );

    const getResponse = await GET(getRequest);
    expect(getResponse.status).toBe(401);

    // Test DELETE without auth
    const deleteRequest = new NextRequest('http://localhost/api/image-test', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apkoId, apkoVersionId: versionId })
    });

    const deleteResponse = await DELETE(deleteRequest);
    expect(deleteResponse.status).toBe(401);
  });

  /**
   * Server action: setImageTestAction should enqueue github_sync
   */
  it('should enqueue github_sync when using setImageTestAction', async () => {
    const result = await setImageTestAction(apkoId, versionId, MOCK_TEST_YAML, 'Test via action');

    expect(result.success).toBe(true);
    expect(enqueueWork).toHaveBeenCalledWith('github_sync', {});
  }, 30000);

  /**
   * Server action: deleteImageTestAction should enqueue github_sync
   */
  it('should enqueue github_sync when using deleteImageTestAction', async () => {
    // Ensure test exists first
    await setImageTestAction(apkoId, versionId, MOCK_TEST_YAML, 'Test to delete');
    jest.clearAllMocks();

    const result = await deleteImageTestAction(apkoId, versionId);

    expect(result.success).toBe(true);
    expect(enqueueWork).toHaveBeenCalledWith('github_sync', {});
  }, 30000);
});
