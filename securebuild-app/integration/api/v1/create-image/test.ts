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

// Mock queue to prevent actual background job execution
jest.mock('@/lib/utils/queue', () => ({
  enqueueWork: jest.fn().mockResolvedValue('mock-work-id')
}));

// Mock cookies to return our test session token
let mockSessionToken: string | undefined;
jest.mock('next/headers', () => ({
  cookies: jest.fn(() => ({
    get: jest.fn((name: string) => {
      if (name === 'buildadmin_session' && mockSessionToken) {
        return { value: mockSessionToken };
      }
      return undefined;
    })
  }))
}));

import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from '../../../fixtures/database';
import { createTestSession } from '../../../fixtures/session';
import path from 'path';
import { POST } from '@/app/api/create-image/route';
import { NextRequest } from 'next/server';
import { enqueueWork } from '@/lib/utils/queue';

const MOCK_APKO_YAML = `contents:
  packages:
    - busybox
    - alpine-base

entrypoint:
  command: /bin/sh
`;

/**
 * Integration tests for POST /api/create-image
 *
 * Tests creating container images with APKO configurations
 */
describe('POST /api/create-image', () => {
  let testDB: TestDatabase;

  beforeAll(async () => {
    testDB = await setupTestDatabase();

    // Set the connection string for this test suite
    testConnectionString = testDB.connectionString;

    // Apply seed data (buildadmin_user, buildadmin_session)
    const seedDataDir = path.join(__dirname, 'seed-data');
    await applySchemaHero(testDB, seedDataDir, true);

    // Generate JWT for test session (session exists in seed data)
    const session = await createTestSession(testDB.pool, 'test-session-fixed-id-123');
    mockSessionToken = session.jwtToken;

    console.log(`Test environment ready: session=${session.sessionId}, user=${session.userId}`);
  });

  afterAll(async () => {
    const { closePoolByUri } = await import("@/lib/data/db");
    await closePoolByUri(testDB.connectionString);

    await teardownTestDatabase(testDB);
  });

  it('should create image with valid configuration', async () => {
    const request = new NextRequest('http://localhost/api/create-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'test-image',
        alternateImage: 'alpine:latest',
        apkos: [{ name: 'test-apko', yaml: MOCK_APKO_YAML, tags: ['latest', 'v1.0'] }]
      })
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.imageId).toBeDefined();

    // Verify image was created using getImage
    const { getImage } = await import('@/lib/image/image');
    const image = await getImage(data.imageId);
    expect(image.name).toBe('test-image');

    // Verify queue was called
    expect(enqueueWork).toHaveBeenCalledWith('build_image', { id: data.imageId });
  });

  it('should return 400 when image already exists', async () => {
    // Create first image
    const request1 = new NextRequest('http://localhost/api/create-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'duplicate-test-image',
        apkos: [{ name: 'test-apko', yaml: MOCK_APKO_YAML, tags: ['latest'] }]
      })
    });
    await POST(request1);

    // Try to create duplicate
    const request2 = new NextRequest('http://localhost/api/create-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'duplicate-test-image',
        apkos: [{ name: 'test-apko', yaml: MOCK_APKO_YAML, tags: ['latest'] }]
      })
    });

    const response = await POST(request2);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('already exists');
  });

  it('should return 401 without session', async () => {
    // Clear the session token to test unauthorized access
    const originalToken = mockSessionToken;
    mockSessionToken = undefined;

    const request = new NextRequest('http://localhost/api/create-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'test-image-2',
        apkos: [{ name: 'test-apko', yaml: MOCK_APKO_YAML, tags: ['latest'] }]
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(401);

    // Restore the token for other tests
    mockSessionToken = originalToken;
  });
});
