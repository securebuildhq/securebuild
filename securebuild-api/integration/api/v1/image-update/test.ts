import * as path from 'path';
import { setupImageUpdateTestEnvironment, ImageUpdateTestEnvironment } from './environment';
import { HttpClient } from '../../../fixtures/http-client';

/**
 * Integration tests for POST /api/v1/image-update and GET /api/v1/image-build/<id>.
 *
 * Phase 1 — POST happy path: system token + valid image + tag → 202 with job_id
 * Phase 2 — Auth: missing/invalid/team-scoped token → 401
 * Phase 3 — Validation: non-git-linked image → 400, nonexistent image → 404, missing fields → 400
 * Phase 4 — Job status: GET status of queued job → 200 with status "queued"
 * Phase 5 — Image build status: GET nonexistent image build → 404
 *
 * Runs against a local Testcontainers stack using real HTTP requests.
 * No worker runs, so jobs remain in "queued" state.
 */
describe('POST /api/v1/image-update', () => {
  let env: ImageUpdateTestEnvironment;
  let createdJobId: string;

  beforeAll(async () => {
    const seedDataDir = path.join(__dirname, 'seed-data');
    env = await setupImageUpdateTestEnvironment(seedDataDir);
  });

  afterAll(async () => {
    await env.teardown();
  });

  describe('Phase 1 — POST happy path', () => {
    it('POST with valid image + tag + system token returns 202 with job_id', async () => {
      const res = await env.client.post('/api/v1/image-update', {
        image_name: 'go',
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
      const res = await env.client.postNoAuth('/api/v1/image-update', {
        image_name: 'go',
        tag: '1.24.13',
      });
      expect(res.status).toBe(401);
    });

    it('POST with invalid token returns 401', async () => {
      const badClient = new HttpClient(env.baseUrl, 'invalid-token');
      const res = await badClient.post('/api/v1/image-update', {
        image_name: 'go',
        tag: '1.24.13',
      });
      expect(res.status).toBe(401);
    });

    it('POST with team-scoped token (not system) returns 401', async () => {
      const teamClient = new HttpClient(env.baseUrl, env.teamToken);
      const res = await teamClient.post('/api/v1/image-update', {
        image_name: 'go',
        tag: '1.24.13',
      });
      expect(res.status).toBe(401);
      const data = res.data as Record<string, unknown>;
      expect(data.error).toContain('system service account token');
    });
  });

  describe('Phase 3 — Validation', () => {
    it('POST with non-git-linked image returns 400', async () => {
      const res = await env.client.post('/api/v1/image-update', {
        image_name: 'non-git-image',
        tag: '1.0.0',
      });
      expect(res.status).toBe(400);
      const data = res.data as Record<string, unknown>;
      expect(data.error).toContain('not linked to a git repository');
    });

    it('POST with nonexistent image returns 404', async () => {
      const res = await env.client.post('/api/v1/image-update', {
        image_name: 'does-not-exist',
        tag: '1.0.0',
      });
      expect(res.status).toBe(404);
    });

    it('POST with missing image_name returns 400', async () => {
      const res = await env.client.post('/api/v1/image-update', {
        tag: '1.24.13',
      });
      expect(res.status).toBe(400);
    });

    it('POST with missing tag returns 400', async () => {
      const res = await env.client.post('/api/v1/image-update', {
        image_name: 'go',
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('GET /api/v1/job/<id>/status (image-update)', () => {
  let env: ImageUpdateTestEnvironment;
  let createdJobId: string;

  beforeAll(async () => {
    const seedDataDir = path.join(__dirname, 'seed-data');
    env = await setupImageUpdateTestEnvironment(seedDataDir);

    const res = await env.client.post('/api/v1/image-update', {
      image_name: 'go',
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
});

describe('GET /api/v1/image-build/<id>', () => {
  let env: ImageUpdateTestEnvironment;

  beforeAll(async () => {
    const seedDataDir = path.join(__dirname, 'seed-data');
    env = await setupImageUpdateTestEnvironment(seedDataDir);
  });

  afterAll(async () => {
    await env.teardown();
  });

  it('GET image build without auth returns 401', async () => {
    const res = await env.client.getNoAuth('/api/v1/image-build/test-build-id');
    expect(res.status).toBe(401);
  });

  it('GET image build with team-scoped token returns 401', async () => {
    const teamClient = new HttpClient(env.baseUrl, env.teamToken);
    const res = await teamClient.get('/api/v1/image-build/test-build-id');
    expect(res.status).toBe(401);
  });

  it('GET image build with nonexistent ID returns 404', async () => {
    const res = await env.client.get('/api/v1/image-build/nonexistent-build-id');
    expect(res.status).toBe(404);
    const data = res.data as Record<string, unknown>;
    expect(data.status).toBe('not_found');
  });
});
