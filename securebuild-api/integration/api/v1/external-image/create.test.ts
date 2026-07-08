import * as path from 'path';
import { setupTestEnvironment, TestEnvironment } from '../../../fixtures/environment';
import { HttpClient } from '../../../fixtures/http-client';

/**
 * Integration tests for POST/GET /api/v1/external-image (the "create" path).
 *
 * Phase 1 — Create:  POST a new image -> 201 + digest, then GET its status.
 * Phase 3 — Auth:    missing/invalid token -> 401.
 *
 * Runs against a local Testcontainers stack using real HTTP requests.
 */
describe('POST/GET /api/v1/external-image', () => {
  let env: TestEnvironment;
  let createdDigest: string;

  beforeAll(async () => {
    const seedDataDir = path.join(__dirname, 'seed-data');
    env = await setupTestEnvironment(seedDataDir);
  });

  afterAll(async () => {
    await env.teardown();
  });

  describe('Phase 1 — Create', () => {
    it('POST /external-image returns 201 with digest', async () => {
      const res = await env.client.post('/api/v1/external-image', {
        image_url: env.createImage,
      });

      expect(res.status).toBe(201);
      const data = res.data as Record<string, unknown>;
      expect(typeof data.digest).toBe('string');
      expect((data.digest as string).startsWith('sha256:')).toBe(true);
      expect(data.image_url).toBe(env.createImage);
      expect(data.status).toBe(201);

      createdDigest = data.digest as string;
    });

    it('GET /external-image?sha=<createdDigest> returns status fields', async () => {
      // No worker runs — the created image has sbom_status='pending' immediately.
      const res = await env.client.get(`/api/v1/external-image?sha=${encodeURIComponent(createdDigest)}`);

      expect(res.status).toBe(200);
      const data = res.data as Record<string, unknown>;
      expect(data.digest).toBe(createdDigest);
      expect(data.sbom_status).toBe('pending');
      expect(data.scan_status).toBeDefined();
      expect(Array.isArray(data.platforms)).toBe(true);
    });
  });

  describe('Phase 3 — Auth', () => {
    it('POST /external-image without token returns 401', async () => {
      const res = await env.client.postNoAuth('/api/v1/external-image', {
        image_url: env.createImage,
      });
      expect(res.status).toBe(401);
    });

    it('GET /external-image without token returns 401', async () => {
      const res = await env.client.getNoAuth(`/api/v1/external-image?sha=${encodeURIComponent(createdDigest)}`);
      expect(res.status).toBe(401);
    });

    it('POST /external-image with invalid token returns 401', async () => {
      const badClient = new HttpClient(env.baseUrl, 'invalid-token');
      const res = await badClient.post('/api/v1/external-image', {
        image_url: env.createImage,
      });
      expect(res.status).toBe(401);
    });
  });
});
