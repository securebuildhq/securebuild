/**
 * Shared test environment for the package-update integration tests.
 *
 * Testcontainers PostgreSQL + real Next.js server on a random port.
 * No worker runs; work_queue rows are created by the API but not processed.
 *
 * Uses real HTTP requests via HttpClient — no module mocking.
 */

import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from '../../../fixtures/database';
import { createTestServiceAccount, createTestSystemServiceAccount } from '../../../fixtures/auth';
import { startTestServer, TestServer } from '../../../fixtures/server';
import { HttpClient } from '../../../fixtures/http-client';

export const SEED_TEAM_ID = 'test-team-alpha';

export interface PackageUpdateTestEnvironment {
  client: HttpClient;
  systemClient: HttpClient;
  baseUrl: string;
  systemToken: string;
  teamToken: string;
  teardown: () => Promise<void>;
}

export async function setupPackageUpdateTestEnvironment(seedDataDir: string): Promise<PackageUpdateTestEnvironment> {
  const testDB: TestDatabase = await setupTestDatabase();

  await applySchemaHero(testDB, seedDataDir, true);

  const systemAccount = await createTestSystemServiceAccount(testDB.pool);
  const teamAccount = await createTestServiceAccount(testDB.pool, SEED_TEAM_ID);

  const serverEnv: Record<string, string> = {
    DB_URI: testDB.connectionString,
  };

  const server: TestServer = await startTestServer(serverEnv);

  const systemClient = new HttpClient(server.baseUrl, systemAccount.token);
  const teamClient = new HttpClient(server.baseUrl, teamAccount.token);

  const teardown = async () => {
    await server.stop();

    const { closePoolByUri } = await import('@/lib/data/db');
    await closePoolByUri(testDB.connectionString);

    await teardownTestDatabase(testDB);
  };

  return {
    client: systemClient,
    systemClient,
    baseUrl: server.baseUrl,
    systemToken: systemAccount.token,
    teamToken: teamAccount.token,
    teardown,
  };
}
