import * as path from 'path';
import {
  SEED_TEAM_ID,
  setupTestEnvironment,
  TestEnvironment,
} from '../../../fixtures/environment';
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

    it('deduplicates active and recovers stale SBOM work', async () => {
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => env.client.post('/api/v1/external-image', {
          image_url: env.createImage,
        })),
      );
      for (const response of responses) {
        expect(response.status).toBe(201);
        expect((response.data as Record<string, unknown>).digest).toBe(createdDigest);
      }

      const result = await env.dbPool.query(
        `SELECT COUNT(*)::int AS count, ARRAY_AGG(dedupe_key ORDER BY dedupe_key) AS dedupe_keys
         FROM work_queue
         WHERE channel = 'external_image_sbom'
           AND completed_at IS NULL
           AND payload->>'digest' = $1`,
        [createdDigest],
      );
      expect(result.rows[0].count).toBe(1);
      expect(result.rows[0].dedupe_keys).toEqual([`${createdDigest}:x86_64`]);

      // Dispatch completion releases the queue key before asynchronous Syft
      // generation completes. The generating status must still suppress a
      // second job during that window.
      await env.dbPool.query(
        `UPDATE work_queue
         SET completed_at = NOW()
         WHERE channel = 'external_image_sbom' AND payload->>'digest' = $1`,
        [createdDigest],
      );
      await env.dbPool.query(
        `UPDATE external_image_sbom_platform_status SET status = 'generating' WHERE digest = $1`,
        [createdDigest],
      );

      const generatingResponse = await env.client.post('/api/v1/external-image', {
        image_url: env.createImage,
      });
      expect(generatingResponse.status).toBe(201);

      const duringGeneration = await env.dbPool.query(
        `SELECT COUNT(*)::int AS count
         FROM work_queue
         WHERE channel = 'external_image_sbom'
           AND completed_at IS NULL
           AND payload->>'digest' = $1`,
        [createdDigest],
      );
      expect(duringGeneration.rows[0].count).toBe(0);

      await env.dbPool.query(
        `UPDATE external_image_sbom_platform_status
         SET status_updated_at = NOW() - INTERVAL '32 minutes'
         WHERE digest = $1`,
        [createdDigest],
      );

      const staleGeneratingResponse = await env.client.post('/api/v1/external-image', {
        image_url: env.createImage,
      });
      expect(staleGeneratingResponse.status).toBe(201);

      const recoveredGeneration = await env.dbPool.query(
        `SELECT
           (SELECT COUNT(*)::int
            FROM work_queue
            WHERE channel = 'external_image_sbom'
              AND completed_at IS NULL
              AND payload->>'digest' = $1) AS count,
           (SELECT status
            FROM external_image_sbom_platform_status
            WHERE digest = $1 AND arch = 'x86_64') AS status`,
        [createdDigest],
      );
      expect(recoveredGeneration.rows[0].count).toBe(1);
      expect(recoveredGeneration.rows[0].status).toBe('pending');

      const retainedCompletedKeys = await env.dbPool.query(
        `SELECT COUNT(*)::int AS count
         FROM work_queue
         WHERE channel = 'external_image_sbom'
           AND completed_at IS NOT NULL
           AND dedupe_key LIKE $1`,
        [`${createdDigest}:%`],
      );
      expect(retainedCompletedKeys.rows[0].count).toBe(0);
    });

    it('GET /external-image?sha=<createdDigest> returns status fields', async () => {
      // No worker runs — the created image has sbom_status='pending' immediately.
      const res = await env.client.get(`/api/v1/external-image?sha=${encodeURIComponent(createdDigest)}`);

      expect(res.status).toBe(200);
      const data = res.data as Record<string, unknown>;
      expect(data.digest).toBe(createdDigest);
      expect(data.sbom_status).toBe('pending');
      expect(data.sbom_statuses).toEqual([
        expect.objectContaining({ arch: 'x86_64', status: 'pending' }),
      ]);
      expect(data.scan_status).toBeDefined();
      expect(Array.isArray(data.platforms)).toBe(true);
    });

    it('does not bypass pending legacy digest-keyed SBOM work', async () => {
      await env.dbPool.query(
        `UPDATE work_queue
         SET completed_at = NOW(), dedupe_key = NULL
         WHERE channel = 'external_image_sbom'
           AND completed_at IS NULL
           AND payload->>'digest' = $1`,
        [createdDigest],
      );
      await env.dbPool.query(
        `INSERT INTO work_queue (id, channel, payload, dedupe_key, created_at, priority)
         VALUES ('legacy-api-sbom-work', 'external_image_sbom', $1, $2, NOW(), 0)`,
        [JSON.stringify({ digest: createdDigest, team_id: 'team-1' }), createdDigest],
      );

      const response = await env.client.post('/api/v1/external-image', {
        image_url: env.createImage,
      });
      expect(response.status).toBe(201);

      const activeWork = await env.dbPool.query(
        `SELECT dedupe_key, payload->>'arch' AS arch
         FROM work_queue
         WHERE channel = 'external_image_sbom'
           AND completed_at IS NULL
           AND payload->>'digest' = $1`,
        [createdDigest],
      );
      expect(activeWork.rows).toEqual([
        { dedupe_key: createdDigest, arch: null },
      ]);
    });

    it('adopts stored legacy SBOMs before building dashboard status', async () => {
      await env.dbPool.query(
        `INSERT INTO external_image_sbom
           (digest, arch, created_at, source, image_size_bytes, image_digest, is_in_object_store)
         VALUES ($1, 'x86_64', NOW(), 'syft', 1, $1, true)
         ON CONFLICT (digest, arch) DO UPDATE
         SET is_in_object_store = true`,
        [createdDigest],
      );
      await env.dbPool.query(
        `DELETE FROM external_image_sbom_platform_status WHERE digest = $1`,
        [createdDigest],
      );
      await env.dbPool.query(
        `INSERT INTO external_image_sbom_status
           (digest, status, status_message, created_at, updated_at, status_updated_at)
         VALUES ($1, 'failed', 'stale legacy failure', NOW(), NOW(), NOW())
         ON CONFLICT (digest) DO UPDATE
         SET status = EXCLUDED.status,
             status_message = EXCLUDED.status_message,
             updated_at = EXCLUDED.updated_at,
             status_updated_at = EXCLUDED.status_updated_at`,
        [createdDigest],
      );

      const previousDBURI = process.env.DB_URI;
      process.env.DB_URI = env.connectionString;
      const { listExternalImages } = await import('@/lib/externalimage/externalimage');
      const images = await listExternalImages(SEED_TEAM_ID);
      if (previousDBURI === undefined) {
        delete process.env.DB_URI;
      } else {
        process.env.DB_URI = previousDBURI;
      }
      const createdImage = images.find(image => image.imageName === 'test-image');

      expect(createdImage?.tagCompletionStatus.latest?.sbomStatus).toBe('succeeded');
      const adopted = await env.dbPool.query(
        `SELECT status
         FROM external_image_sbom_platform_status
         WHERE digest = $1 AND arch = 'x86_64'`,
        [createdDigest],
      );
      expect(adopted.rows).toEqual([{ status: 'succeeded' }]);
    });

    it('attempts every discovered platform when one enqueue transaction fails', async () => {
      await env.dbPool.query(
        `DELETE FROM work_queue
         WHERE channel = 'external_image_sbom' AND payload->>'digest' = $1`,
        [createdDigest],
      );
      await env.dbPool.query(
        `DELETE FROM external_image_sbom_platform_status WHERE digest = $1`,
        [createdDigest],
      );
      await env.dbPool.query(
        `DELETE FROM external_image_sbom WHERE digest = $1`,
        [createdDigest],
      );
      await env.dbPool.query(`
        CREATE FUNCTION reject_x86_sbom_platform_status() RETURNS trigger AS $$
        BEGIN
          IF NEW.arch = 'x86_64' THEN
            RAISE EXCEPTION 'test x86_64 status failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await env.dbPool.query(`
        CREATE TRIGGER reject_x86_sbom_platform_status
        BEFORE INSERT OR UPDATE ON external_image_sbom_platform_status
        FOR EACH ROW EXECUTE FUNCTION reject_x86_sbom_platform_status()
      `);

      const previousDBURI = process.env.DB_URI;
      try {
        process.env.DB_URI = env.connectionString;
        const { enqueueExternalImageSBOMWork } = await import('@/lib/utils/queue');
        await expect(enqueueExternalImageSBOMWork(
          { digest: createdDigest, team_id: SEED_TEAM_ID },
          createdDigest,
          ['x86_64', 'aarch64'],
        )).rejects.toBeInstanceOf(AggregateError);
        const activeWork = await env.dbPool.query(
          `SELECT dedupe_key, payload->>'arch' AS arch
           FROM work_queue
           WHERE channel = 'external_image_sbom'
             AND completed_at IS NULL
             AND payload->>'digest' = $1
           ORDER BY payload->>'arch'`,
          [createdDigest],
        );
        expect(activeWork.rows).toEqual([
          { dedupe_key: `${createdDigest}:aarch64`, arch: 'aarch64' },
        ]);
      } finally {
        if (previousDBURI === undefined) {
          delete process.env.DB_URI;
        } else {
          process.env.DB_URI = previousDBURI;
        }
        await env.dbPool.query(
          `DROP TRIGGER reject_x86_sbom_platform_status ON external_image_sbom_platform_status`,
        );
        await env.dbPool.query(`DROP FUNCTION reject_x86_sbom_platform_status()`);
      }
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
