let testConnectionString: string;

jest.mock("@/lib/data/param", () => ({
  getParam: jest.fn(async (key: string) => {
    if (key === "DB_URI" || key === "DBUri") {
      return testConnectionString;
    }
    throw new Error(`unknown param ${key}`);
  }),
  loadParams: jest.fn(),
}));

import { setupTestDatabase, teardownTestDatabase, TestDatabase } from '../../fixtures/database';
import { getExternalSBOMCounts, listExternalSBOMStatuses } from '@/lib/vulnscan/vulnscan';

describe('external SBOM dashboard legacy compatibility', () => {
  let testDB: TestDatabase;
  const digest = 'sha256:legacy-dashboard-status-123456789012345678901234567890123';

  beforeAll(async () => {
    testDB = await setupTestDatabase();
    testConnectionString = testDB.connectionString;

    await testDB.pool.query(
      `INSERT INTO external_image_sbom_status
         (digest, status, status_message, created_at, updated_at, status_updated_at)
       VALUES ($1, 'pending', 'legacy pending', NOW(), NOW(), NOW())`,
      [digest],
    );
    await testDB.pool.query(
      `INSERT INTO external_image_sbom_platform_status
         (digest, arch, status, status_message, created_at, updated_at, status_updated_at)
       VALUES ($1, 'aarch64', 'failed', 'arm failed', NOW(), NOW(), NOW())`,
      [digest],
    );
  }, 60000);

  afterAll(async () => {
    const { closePoolByUri } = await import('@/lib/data/db');
    await closePoolByUri(testDB.connectionString);
    await teardownTestDatabase(testDB);
  });

  it('shows legacy state as x86_64 alongside real platform state', async () => {
    const counts = await getExternalSBOMCounts('1hr');
    expect(counts).toEqual({ pending: 1, generating: 0, succeeded: 0, failed: 1, total: 2 });

    const { statuses, totalCount } = await listExternalSBOMStatuses({ digest });
    expect(totalCount).toBe(2);
    expect(statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ digest, arch: 'x86_64', status: 'pending' }),
      expect.objectContaining({ digest, arch: 'aarch64', status: 'failed' }),
    ]));
  });

  it('stops exposing legacy state once x86_64 has a platform row', async () => {
    await testDB.pool.query(
      `INSERT INTO external_image_sbom_platform_status
         (digest, arch, status, status_message, created_at, updated_at, status_updated_at)
       VALUES ($1, 'x86_64', 'succeeded', NULL, NOW(), NOW(), NOW())`,
      [digest],
    );

    const counts = await getExternalSBOMCounts('1hr');
    expect(counts).toEqual({ pending: 0, generating: 0, succeeded: 1, failed: 1, total: 2 });

    const { statuses, totalCount } = await listExternalSBOMStatuses({ digest });
    expect(totalCount).toBe(2);
    expect(statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ digest, arch: 'x86_64', status: 'succeeded' }),
      expect.objectContaining({ digest, arch: 'aarch64', status: 'failed' }),
    ]));
    expect(statuses.some(status => status.statusMessage === 'legacy pending')).toBe(false);
  });
});
