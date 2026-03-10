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
import { POST } from '@/app/api/withdraw-package/route';
import { NextRequest } from 'next/server';

/**
 * Integration tests for POST /api/withdraw-package
 *
 * Tests withdrawing packages from the APK repository by marking them as withdrawn
 */
describe('POST /api/withdraw-package', () => {
  let testDB: TestDatabase;

  beforeAll(async () => {
    testDB = await setupTestDatabase();

    // Set the connection string for this test suite
    testConnectionString = testDB.connectionString;

    // Apply seed data (buildadmin_user, buildadmin_session, apk_catalog)
    const seedDataDir = path.join(__dirname, 'seed-data');
    await applySchemaHero(testDB, seedDataDir, true);

    // Generate JWT for test session (session exists in seed data)
    const session = await createTestSession(testDB.pool, 'test-session-fixed-id-123');
    mockSessionToken = session.jwtToken;
    console.log(`Test environment ready: session=${session.sessionId}, user=${session.userId}`);
  });

  afterAll(async () => {
    // Close the pool created by getDB() for this specific test's connection string
    const { closePoolByUri } = await import("@/lib/data/db");
    await closePoolByUri(testDB.connectionString);

    await teardownTestDatabase(testDB);
  });

  it('should withdraw package with multiple architectures', async () => {
    const filename = 'test-package-1.0.0-r0.apk';

    // Verify initial state - both architectures should have is_withdrawn = false
    const beforeResult = await testDB.pool.query(
      'SELECT arch, is_withdrawn FROM apk_catalog WHERE filename = $1',
      [filename]
    );
    expect(beforeResult.rows.length).toBe(2);
    expect(beforeResult.rows.every((row: any) => row.is_withdrawn === false)).toBe(true);

    const request = new NextRequest('http://localhost/api/withdraw-package', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filename
      })
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toContain(filename);

    // Verify both architectures are marked as withdrawn
    const afterResult = await testDB.pool.query(
      'SELECT arch, is_withdrawn FROM apk_catalog WHERE filename = $1',
      [filename]
    );
    expect(afterResult.rows.length).toBe(2);
    expect(afterResult.rows.every((row: any) => row.is_withdrawn === true)).toBe(true);
  });

  it('should withdraw package with single architecture', async () => {
    const filename = 'single-arch-package-2.0.0-r1.apk';

    // Verify initial state
    const beforeResult = await testDB.pool.query(
      'SELECT is_withdrawn FROM apk_catalog WHERE filename = $1',
      [filename]
    );
    expect(beforeResult.rows.length).toBe(1);
    expect(beforeResult.rows[0].is_withdrawn).toBe(false);

    const request = new NextRequest('http://localhost/api/withdraw-package', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filename
      })
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify the package is marked as withdrawn
    const afterResult = await testDB.pool.query(
      'SELECT is_withdrawn FROM apk_catalog WHERE filename = $1',
      [filename]
    );
    expect(afterResult.rows.length).toBe(1);
    expect(afterResult.rows[0].is_withdrawn).toBe(true);
  });

  it('should return 404 when filename does not exist', async () => {
    const filename = 'non-existent-package-1.0.0-r0.apk';

    const request = new NextRequest('http://localhost/api/withdraw-package', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filename
      })
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain('No APK catalog records found');
    expect(data.error).toContain(filename);
  });

  it('should return 401 without authorization', async () => {
    // Clear the session token to test unauthorized access
    const originalToken = mockSessionToken;
    mockSessionToken = undefined;

    const request = new NextRequest('http://localhost/api/withdraw-package', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filename: 'test-package-1.0.0-r0.apk'
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(401);

    // Restore the token for other tests
    mockSessionToken = originalToken;
  });

  it('should return 400 when filename is missing', async () => {
    const request = new NextRequest('http://localhost/api/withdraw-package', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('filename is required');
  });

  it('should return 400 when filename is empty', async () => {
    const request = new NextRequest('http://localhost/api/withdraw-package', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filename: ''
      })
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('filename is required');
  });
});
