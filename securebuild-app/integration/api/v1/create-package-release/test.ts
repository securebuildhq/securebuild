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
      throw new ValidationError('Invalid melange YAML');
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
import { POST } from '@/app/api/create-package-release/route';
import { NextRequest } from 'next/server';

const MOCK_MELANGE_YAML_V1_R2 = `package:
  name: test-package-release
  version: 1.0.0
  epoch: 2
  description: Test package for releases - revision 2

environment:
  contents:
    packages:
      - busybox
      - alpine-base

pipeline:
  - runs: |
      echo "version 1.0.0 revision 2"
`;

/**
 * Integration tests for POST /api/create-package-release
 *
 * Tests creating new releases (revisions) for existing packages
 */
describe('POST /api/create-package-release', () => {
  let testDB: TestDatabase;
  let packageId: string;

  beforeAll(async () => {
    testDB = await setupTestDatabase();

    // Set the connection string for this test suite
    testConnectionString = testDB.connectionString;

    // Setup temporary pipeline directory
    testPipelineDir = setupTestPipelineDir();

    // Apply seed data (buildadmin_user, buildadmin_session, package, package_version)
    const seedDataDir = path.join(__dirname, 'seed-data');
    await applySchemaHero(testDB, seedDataDir, true);

    // Generate JWT for test session (session exists in seed data)
    const session = await createTestSession(testDB.pool, 'test-session-fixed-id-123');
    mockSessionToken = session.jwtToken;

    // Package and version exist in seed data
    packageId = 'test-package-release-id-123';

    console.log(`Test environment ready: session=${session.sessionId}, user=${session.userId}, package=${packageId}`);
  });

  afterAll(async () => {
    const { closePoolByUri } = await import("@/lib/data/db");
    await closePoolByUri(testDB.connectionString);

    await teardownTestDatabase(testDB);

    // Clean up pipeline directory
    if (testPipelineDir) {
      fs.rmSync(testPipelineDir, { recursive: true, force: true });
    }
  });

  it('should create new release for existing package', async () => {
    const melangeYamlBase64 = Buffer.from(MOCK_MELANGE_YAML_V1_R2).toString('base64');

    const request = new NextRequest('http://localhost/api/create-package-release', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pkgId: packageId,
        version: '1.0.0',
        melangeYamlBase64
      })
    });

    const response = await POST(request);
    const data = await response.json();

    if (response.status !== 200) {
      console.log('Error response:', data);
    }

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.packageVersion).toBeDefined();

    // Verify new release was created using getMostRecentPackageVersion
    const { getMostRecentPackageVersion } = await import('@/lib/package/package');
    const mostRecentVersion = await getMostRecentPackageVersion(packageId);
    expect(mostRecentVersion.apkRelease).toBe(2);
  });

  it('should return 400 for version mismatch', async () => {
    const melangeYamlBase64 = Buffer.from(MOCK_MELANGE_YAML_V1_R2).toString('base64');

    const request = new NextRequest('http://localhost/api/create-package-release', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pkgId: packageId,
        version: '2.0.0', // Mismatch with YAML which has 1.0.0
        melangeYamlBase64
      })
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBeTruthy();
    expect(data.error.length).toBeGreaterThan(0);
  });
});
