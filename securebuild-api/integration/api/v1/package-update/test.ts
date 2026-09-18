import * as path from 'path';
import { setupPackageUpdateTestEnvironment, PackageUpdateTestEnvironment } from './environment';
import { HttpClient } from '../../../fixtures/http-client';

/**
 * Integration tests for POST /api/v1/package-update and GET /api/v1/job/<id>/status.
 *
 * Phase 1 — POST happy path: system token + valid family + valid tag → 202 with job_id
 * Phase 2 — Auth: missing/invalid/team-scoped token → 401
 * Phase 3 — Validation: non-git-linked family → 400, nonexistent family → 404, bad tag → 400
 * Phase 4 — Job status: GET status of queued job → 200 with status "queued"
 *
 * Runs against a local Testcontainers stack using real HTTP requests.
 * No worker runs, so jobs remain in "queued" state.
 */
describe('POST /api/v1/package-update', () => {
  let env: PackageUpdateTestEnvironment;
  let createdJobId: string;

  beforeAll(async () => {
    const seedDataDir = path.join(__dirname, 'seed-data');
    env = await setupPackageUpdateTestEnvironment(seedDataDir);
  });

  afterAll(async () => {
    await env.teardown();
  });

  describe('Phase 1 — POST happy path', () => {
    it('POST with valid family + tag + system token returns 202 with job_id', async () => {
      const res = await env.client.post('/api/v1/package-update', {
        package_family_name: 'go',
        tag: '1.24.13',
      });

      expect(res.status).toBe(202);
      const data = res.data as Record<string, unknown>;
      expect(typeof data.job_id).toBe('string');
      expect((data.job_id as string).length).toBeGreaterThan(0);

      createdJobId = data.job_id as string;
    });
  });

  describe('Phase 2 — Auth', () => {
    it('POST without auth header returns 401', async () => {
      const res = await env.client.postNoAuth('/api/v1/package-update', {
        package_family_name: 'go',
        tag: '1.24.13',
      });
      expect(res.status).toBe(401);
    });

    it('POST with invalid token returns 401', async () => {
      const badClient = new HttpClient(env.baseUrl, 'invalid-token');
      const res = await badClient.post('/api/v1/package-update', {
        package_family_name: 'go',
        tag: '1.24.13',
      });
      expect(res.status).toBe(401);
    });

    it('POST with team-scoped token (not system) returns 401', async () => {
      const teamClient = new HttpClient(env.baseUrl, env.teamToken);
      const res = await teamClient.post('/api/v1/package-update', {
        package_family_name: 'go',
        tag: '1.24.13',
      });
      expect(res.status).toBe(401);
      const data = res.data as Record<string, unknown>;
      expect(data.error).toContain('system service account token');
    });
  });

  describe('Phase 3 — Validation', () => {
    it('POST with non-git-linked family returns 400', async () => {
      const res = await env.client.post('/api/v1/package-update', {
        package_family_name: 'busybox',
        tag: '1.36.1',
      });
      expect(res.status).toBe(400);
      const data = res.data as Record<string, unknown>;
      expect(data.error).toContain('not linked to a git repository');
    });

    it('POST with nonexistent family returns 404', async () => {
      const res = await env.client.post('/api/v1/package-update', {
        package_family_name: 'does-not-exist',
        tag: '1.0.0',
      });
      expect(res.status).toBe(404);
    });

    it('POST with invalid semver tag returns 400', async () => {
      const res = await env.client.post('/api/v1/package-update', {
        package_family_name: 'go',
        tag: 'not-a-version',
      });
      expect(res.status).toBe(400);
      const data = res.data as Record<string, unknown>;
      expect(data.error).toContain('not a valid semantic version');
    });

    it('POST accepts a git tag with prerelease and build metadata', async () => {
      const res = await env.client.post('/api/v1/package-update', {
        package_family_name: 'go',
        tag: '1.24.13-rc.1+k8s-1.35',
      });
      expect(res.status).toBe(202);
    });

    it('POST with missing package_family_name returns 400', async () => {
      const res = await env.client.post('/api/v1/package-update', {
        tag: '1.24.13',
      });
      expect(res.status).toBe(400);
    });

    it('POST with missing tag returns 400', async () => {
      const res = await env.client.post('/api/v1/package-update', {
        package_family_name: 'go',
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('GET /api/v1/job/<id>/status', () => {
  let env: PackageUpdateTestEnvironment;
  let createdJobId: string;

  beforeAll(async () => {
    const seedDataDir = path.join(__dirname, 'seed-data');
    env = await setupPackageUpdateTestEnvironment(seedDataDir);

    const res = await env.client.post('/api/v1/package-update', {
      package_family_name: 'go',
      tag: '1.24.13',
    });
    expect(res.status).toBe(202);
    createdJobId = (res.data as Record<string, unknown>).job_id as string;
  });

  afterAll(async () => {
    await env.teardown();
  });

  it('GET job status of queued job returns 200 with status "queued"', async () => {
    const res = await env.client.get(`/api/v1/job/${createdJobId}/status`);
    expect(res.status).toBe(200);
    const data = res.data as Record<string, unknown>;
    expect(data.status).toBe('queued');
  });

  it('GET job status without auth returns 401', async () => {
    const res = await env.client.getNoAuth(`/api/v1/job/${createdJobId}/status`);
    expect(res.status).toBe(401);
  });

  it('GET job status with team-scoped token returns 401', async () => {
    const teamClient = new HttpClient(env.baseUrl, env.teamToken);
    const res = await teamClient.get(`/api/v1/job/${createdJobId}/status`);
    expect(res.status).toBe(401);
  });

  it('GET job status with invalid job ID returns 404', async () => {
    const res = await env.client.get('/api/v1/job/invalid-job-id/status');
    expect(res.status).toBe(404);
    const data = res.data as Record<string, unknown>;
    expect(data.status).toBe('expired');
  });
});

describe('GET /api/v1/package-version/<id>', () => {
  let env: PackageUpdateTestEnvironment;

  beforeAll(async () => {
    const seedDataDir = path.join(__dirname, 'seed-data');
    env = await setupPackageUpdateTestEnvironment(seedDataDir);
  });

  afterAll(async () => {
    await env.teardown();
  });

  it('GET package version without auth returns 401', async () => {
    const res = await env.client.getNoAuth('/api/v1/package-version/test-version-id');
    expect(res.status).toBe(401);
  });

  it('GET package version with team-scoped token returns 401', async () => {
    const teamClient = new HttpClient(env.baseUrl, env.teamToken);
    const res = await teamClient.get('/api/v1/package-version/test-version-id');
    expect(res.status).toBe(401);
  });

  it('GET package version with nonexistent ID returns 404', async () => {
    const res = await env.client.get('/api/v1/package-version/nonexistent-version-id');
    expect(res.status).toBe(404);
    const data = res.data as Record<string, unknown>;
    expect(data.status).toBe('not_found');
  });

  it.each(['failed', 'vm_deleted'])('reports a queued retry of a %s build until its new execution starts', async (failedStatus) => {
    await env.pool.query('DELETE FROM execution WHERE package_version_id = $1', ['test-retry-version']);
    await env.pool.query("DELETE FROM work_queue WHERE channel = 'build_package'");
    await env.pool.query(`
      INSERT INTO execution (id, package_id, package_version_id, version_label, status, created_at,
                             x86_64_status, aarch64_status)
      VALUES ('old-attempt', 'test-retry-package', 'test-retry-version', '1.0.0', $1,
              '2025-01-01', $1, $1)`, [failedStatus]);

    const status = async () => {
      const res = await env.client.get('/api/v1/package-version/test-retry-version');
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ version: '1.0.0', apk_release: 0 });
      return res.data as Record<string, unknown>;
    };
    expect((await status()).status).toBe(failedStatus);

    await env.pool.query(`
      INSERT INTO work_queue (id, channel, payload, created_at)
      VALUES ('retry-build', 'build_package', $1, '2025-01-02')`,
      [JSON.stringify({ packageId: 'test-retry-package', packageVersionId: 'test-retry-version', retryOfExecutionId: 'old-attempt' })]);
    const queued = await status();
    expect(queued.status).toBe('queued');
    expect(queued.x86_64_status).toBeUndefined();
    expect(queued.aarch64_status).toBeUndefined();

    // A completed queue item must no longer hide a failed execution.
    await env.pool.query("UPDATE work_queue SET completed_at = NOW() WHERE id = 'retry-build'");
    expect((await status()).status).toBe(failedStatus);
    await env.pool.query("UPDATE work_queue SET completed_at = NULL WHERE id = 'retry-build'");

    // Once the handler creates an execution, report it even while the work
    // item remains in progress. A second failure must be visible to the CLI.
    await env.pool.query(`
      INSERT INTO execution (id, package_id, package_version_id, version_label, status, created_at)
      VALUES ('new-attempt', 'test-retry-package', 'test-retry-version', '1.0.0', 'pending', '2025-01-03')`);
    for (const nextStatus of ['pending', 'queued', 'building', 'failed', 'success']) {
      await env.pool.query("UPDATE execution SET status = $1 WHERE id = 'new-attempt'", [nextStatus]);
      expect((await status()).status).toBe(nextStatus);
    }

    // Historical success is authoritative even if a legacy later attempt
    // failed and a retry was queued for that failure.
    await env.pool.query(`
      INSERT INTO execution (id, package_id, package_version_id, version_label, status, created_at)
      VALUES ('later-failure', 'test-retry-package', 'test-retry-version', '1.0.0', 'failed', '2025-01-04')`);
    await env.pool.query(`UPDATE work_queue SET payload = jsonb_set(payload, '{retryOfExecutionId}', '"later-failure"'),
                         created_at = '2025-01-05' WHERE id = 'retry-build'`);
    expect((await status()).status).toBe('success');
  });

});
