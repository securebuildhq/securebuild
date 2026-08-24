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
});
