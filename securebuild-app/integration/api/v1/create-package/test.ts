// Store the test connection string for this test suite
let testConnectionString: string;
let testPipelineDir: string;

// Mock getParam to return this test's connection string and PIPELINE_DIR
jest.mock("@/lib/data/param", () => ({
  getParam: jest.fn(async (key: string) => {
    if (key === "DB_URI" || key === "DBUri") {
      return testConnectionString;
    }
    if (key === "PIPELINE_DIR") {
      return testPipelineDir;
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

// Mock melange validation - control pass/fail behavior per test
let shouldValidationPass = true;
jest.mock('@/lib/melange/validation', () => ({
  validateMelangeYAML: jest.fn(async (yaml: string) => {
    if (!shouldValidationPass) {
      const { ValidationError } = jest.requireActual('@/lib/errors/validation-error');
      throw new ValidationError('2025/11/05 08:30:31 ERRO failed to load configuration: unable to decode configuration file "melange-test.yaml": yaml: unmarshal errors:\n  line 1: cannot unmarshal !!str `��~...` into config.Configuration\n');
    }
    // Pass - do nothing
  }),
  checkMelangeAvailable: jest.fn(async () => true)
}));

// Mock melange executor to use yaml.load instead of running melange binary
jest.mock('@/lib/package/melange-executor', () => ({
  executeMelangeCompile: jest.fn(async (melangeYamlPath: string, pipelineDir: string) => {
    // In tests, use simple yaml.load instead of melange compile
    const fs = require('fs/promises');
    const yaml = require('js-yaml');
    const content = await fs.readFile(melangeYamlPath, 'utf8');
    return yaml.load(content);
  })
}));

import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from '../../../fixtures/database';
import { createTestSession } from '../../../fixtures/session';
import { setupTestPipelineDir } from '../../../fixtures/pipeline';
import path from 'path';
import fs from 'fs';
import { POST } from '@/app/api/create-package/route';
import { NextRequest } from 'next/server';
import { getPackageByName } from '@/lib/package/package';

const MOCK_MELANGE_YAML = `package:
  name: test-package
  version: 1.0.0
  epoch: 0
  description: Test package

environment:
  contents:
    packages:
      - busybox

pipeline:
  - runs: |
      echo "test build"
`;

/**
 * Integration tests for POST /api/create-package
 *
 * Tests creating packages from melange.yaml configurations
 */
describe('POST /api/create-package', () => {
  let testDB: TestDatabase;

  beforeAll(async () => {
    testDB = await setupTestDatabase();

    // Set the connection string for this test suite
    testConnectionString = testDB.connectionString;

    // Setup temporary pipeline directory
    testPipelineDir = setupTestPipelineDir();

    // Apply seed data (buildadmin_user, buildadmin_session)
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

    // Clean up pipeline directory
    if (testPipelineDir) {
      fs.rmSync(testPipelineDir, { recursive: true, force: true });
    }
  });

  it('should create package with valid melange.yaml', async () => {
    const melangeYamlBase64 = Buffer.from(MOCK_MELANGE_YAML).toString('base64');

    const request = new NextRequest('http://localhost/api/create-package', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        melangeYamlBase64,
        useRoot: false
      })
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.packageId).toBeDefined();

    // Verify package was created in database using getPackageByName
    const pkg = await getPackageByName('test-package');
    expect(pkg).toBeDefined();
    expect(pkg.id).toBe(data.packageId);
    expect(pkg.name).toBe('test-package');
  });

  it('should return 401 without authorization', async () => {
    // Clear the session token to test unauthorized access
    const originalToken = mockSessionToken;
    mockSessionToken = undefined;

    const melangeYamlBase64 = Buffer.from(MOCK_MELANGE_YAML).toString('base64');

    const request = new NextRequest('http://localhost/api/create-package', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        melangeYamlBase64,
        useRoot: false
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(401);

    // Restore the token for other tests
    mockSessionToken = originalToken;
  });
});
