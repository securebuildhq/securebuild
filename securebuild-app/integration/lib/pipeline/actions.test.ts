/**
 * Integration tests for pipeline server actions
 * Tests CRUD operations for pipelines with path-based structure
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

// Mock queue to prevent actual background job execution during tests
jest.mock('@/lib/utils/queue', () => ({
  enqueueWork: jest.fn().mockResolvedValue('mock-work-id')
}));

// Mock cookies to return our test session token
let mockSessionToken: string | undefined;
jest.mock('next/headers', () => ({
  headers: jest.fn(() => ({
    get: jest.fn(() => null)
  })),
  cookies: jest.fn(() => ({
    get: jest.fn((name: string) => {
      if (name === 'buildadmin_session' && mockSessionToken) {
        return { value: mockSessionToken };
      }
      return undefined;
    })
  }))
}));

// Mock reserved pipelines check - returns false (not reserved) for test paths
jest.mock('@/lib/pipeline/reserved-pipelines', () => ({
  isReservedPipeline: jest.fn().mockResolvedValue(false)
}));

import path from 'path';
import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from '../../fixtures/database';
import { createTestSession } from '../../fixtures/session';
import { Session } from '@/lib/types/session';
import {
  listPipelinesAction,
  createPipelineAction,
  updatePipelineAction,
  deletePipelineAction
} from '@/lib/pipeline/actions/pipeline-actions';
import { enqueueWork } from '@/lib/utils/queue';

const MOCK_TEST_PIPELINE = [
  'name: smoke-binary',
  '',
  'pipeline:',
  '  - runs: |',
  '      pkg=$(basename ' + '${{targets.contextdir}})',
  '      apk info "$pkg" | grep -q "installed"',
  '      echo "Package $pkg is installed"'
].join('\n');

describe('Pipeline Server Actions Integration Tests', () => {
  let testDB: TestDatabase;
  let session: Session;

  beforeAll(async () => {
    testDB = await setupTestDatabase();
    testConnectionString = testDB.connectionString;

    // Apply seed data (buildadmin_user, buildadmin_session)
    const seedDataDir = path.join(__dirname, 'seed-data');
    await applySchemaHero(testDB, seedDataDir, true);

    // Generate JWT for test session (session exists in seed data)
    const testSession = await createTestSession(testDB.pool, 'test-session-pipeline-123');
    mockSessionToken = testSession.jwtToken;

    // Get session using getServerSession (which reads from mocked cookies)
    const { getServerSession } = await import('@/lib/auth/server-session');
    const retrievedSession = await getServerSession();

    if (!retrievedSession) {
      throw new Error('Failed to retrieve test session');
    }

    session = retrievedSession;

    console.log(`Test environment ready: session=${session.id}, user=${session.user.id}`);
  }, 60000);

  afterAll(async () => {
    const { closePoolByUri } = await import("@/lib/data/db");
    await closePoolByUri(testDB.connectionString);

    await teardownTestDatabase(testDB);
  });

  beforeEach(() => {
    // Clear mock call history before each test
    jest.clearAllMocks();
  });

  /**
   * Main pipeline handler test - tests full CRUD lifecycle
   */
  it('should handle pipeline CRUD operations', async () => {
    // Create a pipeline with deeply nested path
    const createdPipeline = await createPipelineAction({
      pipelineType: 'package',
      path: 'test/integration/smoke/binary',
      yamlContent: MOCK_TEST_PIPELINE,
      description: 'Test pipeline for smoke testing'
    });

    expect(createdPipeline.path).toBe('test/integration/smoke/binary');
    expect(createdPipeline.pipelineType).toBe('package');
    expect(createdPipeline.yamlContent).toBe(MOCK_TEST_PIPELINE);
    expect(createdPipeline.description).toBe('Test pipeline for smoke testing');

    // Verify ID format (32-character hex string)
    expect(createdPipeline.id).toMatch(/^[0-9a-f]{32}$/);
    expect(createdPipeline.id.length).toBe(32);

    // Verify pipeline_sync was triggered with correct payload
    expect(enqueueWork).toHaveBeenCalledWith('pipeline_sync', {
      path: 'test/integration/smoke/binary',
      operation: 'create',
      type: 'package'
    });
    jest.clearAllMocks();

    // Update the pipeline
    const updatedYaml = 'name: smoke-binary-v2\npipeline:\n  - runs: |\n      echo "updated"\n';
    const updatedPipeline = await updatePipelineAction('test/integration/smoke/binary', {
      path: 'test/integration/smoke/binary-v2',
      yamlContent: updatedYaml,
      description: 'Updated test pipeline'
    });

    expect(updatedPipeline.path).toBe('test/integration/smoke/binary-v2');
    expect(updatedPipeline.yamlContent).toBe(updatedYaml);
    expect(updatedPipeline.description).toBe('Updated test pipeline');

    // Verify pipeline_sync was triggered with correct payload (includes oldPath for updates)
    expect(enqueueWork).toHaveBeenCalledWith('pipeline_sync', {
      path: 'test/integration/smoke/binary-v2',
      oldPath: 'test/integration/smoke/binary',
      operation: 'update',
      type: 'package'
    });
    jest.clearAllMocks();

    // List all pipelines
    const allPipelines = await listPipelinesAction();
    expect(Array.isArray(allPipelines)).toBe(true);
    expect(allPipelines.length).toBeGreaterThanOrEqual(1);

    // Verify pipeline is in the list
    const paths = allPipelines.map(p => p.path);
    expect(paths).toContain('test/integration/smoke/binary-v2');

    // Delete the pipeline
    await deletePipelineAction('test/integration/smoke/binary-v2');

    // Verify pipeline_sync was triggered with correct payload
    expect(enqueueWork).toHaveBeenCalledWith('pipeline_sync', {
      path: 'test/integration/smoke/binary-v2',
      operation: 'delete',
      type: 'package'
    });

    // Verify it's gone by checking the list
    const afterDelete = await listPipelinesAction();
    const pathsAfterDelete = afterDelete.map(p => p.path);
    expect(pathsAfterDelete).not.toContain('test/integration/smoke/binary-v2');
  }, 30000);

  /**
   * Test duplicate path validation
   */
  it('should reject duplicate pipeline paths', async () => {
    // Create first pipeline
    await createPipelineAction({
      pipelineType: 'package',
      path: 'test/duplicate-test',
      yamlContent: MOCK_TEST_PIPELINE,
      description: 'First pipeline'
    });

    // Try to create another with the same path
    try {
      await createPipelineAction({
        pipelineType: 'package',
        path: 'test/duplicate-test',
        yamlContent: MOCK_TEST_PIPELINE,
        description: 'Duplicate pipeline'
      });
      fail('Should have thrown error for duplicate path');
    } catch (error: any) {
      expect(error.message).toContain('already exists');
    }
  }, 30000);

  /**
   * Test error handling for non-existent pipeline deletion
   */
  it('should throw ValidationError when deleting non-existent pipeline', async () => {
    // Deleting a non-existent pipeline should throw a ValidationError
    await expect(deletePipelineAction('nonexistent/pipeline')).rejects.toThrow('Pipeline not found');
  }, 30000);

  /**
   * Test case sensitivity
   */
  it('should treat paths as case-sensitive', async () => {
    // Create pipeline with lowercase
    await createPipelineAction({
      pipelineType: 'package',
      path: 'test/lowercase',
      yamlContent: 'name: lower\npipeline:\n  - runs: |\n      echo "lower"\n',
    });

    // Create pipeline with uppercase - should be different
    await createPipelineAction({
      pipelineType: 'package',
      path: 'test/UPPERCASE',
      yamlContent: 'name: upper\npipeline:\n  - runs: |\n      echo "upper"\n',
    });

    const pipelines = await listPipelinesAction();
    const paths = pipelines.map(p => p.path);

    expect(paths).toContain('test/lowercase');
    expect(paths).toContain('test/UPPERCASE');

    // Clean up
    await deletePipelineAction('test/lowercase');
    await deletePipelineAction('test/UPPERCASE');
  }, 30000);

  /**
   * Test image pipeline creation - should not be blocked by reserved pipeline validation
   */
  it('should create image pipelines without reserved pipeline validation', async () => {
    const MOCK_IMAGE_PIPELINE = `
name: test-image
pipeline:
  - runs: |
      echo "Building test image"
`;

    // Create an image pipeline - this should not fail even if the path matches a reserved package pipeline name
    const createdPipeline = await createPipelineAction({
      pipelineType: 'image',
      path: 'fetch', // This is a reserved package pipeline name but should be allowed for image pipelines
      yamlContent: MOCK_IMAGE_PIPELINE,
      description: 'Test image pipeline'
    });

    expect(createdPipeline.path).toBe('fetch');
    expect(createdPipeline.pipelineType).toBe('image');
    expect(createdPipeline.yamlContent).toBe(MOCK_IMAGE_PIPELINE);
    expect(createdPipeline.description).toBe('Test image pipeline');

    // Clean up
    await deletePipelineAction('fetch', 'image');
  }, 30000);
});
