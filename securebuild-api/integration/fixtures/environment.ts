/**
 * Shared test environment for the external-image integration tests.
 *
 * Testcontainers PostgreSQL + local Docker registry + real Next.js server on a
 * random port. No worker runs; scan/SBOM data is seeded.
 *
 * Uses real HTTP requests via HttpClient — no module mocking.
 */

import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from './database';
import { createTestServiceAccount } from './auth';
import { setupTestRegistry, teardownTestRegistry, TestRegistry } from './registry';
import { startTestServer, TestServer } from './server';
import { HttpClient } from './http-client';
import { Pool } from 'pg';

// Seeded "existing" image used for read endpoint validation.
export const SEEDED_EXISTING_IMAGE = 'test-registry.example.com/test-org/test-image:latest';
export const SEEDED_EXISTING_DIGEST = 'sha256:abc123def456789012345678901234567890123456789012345678901234';

export const SEED_TEAM_ID = 'test-team-alpha';

// Encryption secret for storing registry pull credentials.
const TEST_ENCRYPTION_SECRET = 'test-encryption-secret-32bytes!!';

export interface TestEnvironment {
  client: HttpClient;
  baseUrl: string;
  token: string;
  createImage: string;
  existingImage: string;
  existingDigest: string;
  dbPool: Pool;
  connectionString: string;
  teardown: () => Promise<void>;
}

export async function setupTestEnvironment(seedDataDir: string): Promise<TestEnvironment> {
  const testDB: TestDatabase = await setupTestDatabase();

  await applySchemaHero(testDB, seedDataDir, true);

  const serviceAccount = await createTestServiceAccount(testDB.pool, SEED_TEAM_ID);

  const registry: TestRegistry = await setupTestRegistry();

  const serverEnv: Record<string, string> = {
    DB_URI: testDB.connectionString,
    EXTERNAL_REGISTRY_ENCRYPTION_SECRET: TEST_ENCRYPTION_SECRET,
  };

  const server: TestServer = await startTestServer(serverEnv);

  const client = new HttpClient(server.baseUrl, serviceAccount.token);

  const teardown = async () => {
    await server.stop();

    const { closePoolByUri } = await import('@/lib/data/db');
    await closePoolByUri(testDB.connectionString);

    await teardownTestDatabase(testDB);
    await teardownTestRegistry(registry);
  };

  return {
    client,
    baseUrl: server.baseUrl,
    token: serviceAccount.token,
    createImage: registry.imageUrl,
    existingImage: SEEDED_EXISTING_IMAGE,
    existingDigest: SEEDED_EXISTING_DIGEST,
    dbPool: testDB.pool,
    connectionString: testDB.connectionString,
    teardown,
  };
}
