import * as path from 'path';
import { setupTestEnvironment, TestEnvironment } from '../../../fixtures/environment';
import { HttpClient } from '../../../fixtures/http-client';

const VALID_SCAN_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed']);
const SUMMARY_ONLY_DIGEST = 'sha256:summary123456789012345678901234567890123456789012345678901234';

/**
 * Integration tests for the read endpoints (scan, scan-summary, sbom).
 *
 * Phase 2 — Read:  validates shape of scan/scan-summary/sbom responses against
 *                  the pre-scanned "existing" image (seeded via YAML).
 * Phase 3 — Auth:  missing token -> 401 on each read endpoint.
 *
 * Runs against a local Testcontainers stack using real HTTP requests.
 */
describe('Read endpoints /scan, /scan-summary, /sbom', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    const seedDataDir = path.join(__dirname, 'seed-data');
    env = await setupTestEnvironment(seedDataDir);
  });

  afterAll(async () => {
    await env.teardown();
  });

  describe('Phase 2 — Read (existing image)', () => {
    const digest = () => env.existingDigest;
    const image = () => env.existingImage;

    it('GET /scan?digest&arch=amd64&format=parsed returns counts + vulnerability_details', async () => {
      const res = await env.client.get(
        `/api/v1/external-image/scan?digest=${encodeURIComponent(digest())}&arch=amd64&format=parsed`,
      );
      expect(res.status).toBe(200);

      const data = res.data as Record<string, unknown>;
      expect(data.counts).toBeDefined();
      const counts = data.counts as Record<string, unknown>;
      expect(typeof counts.critical).toBe('number');
      expect(typeof counts.high).toBe('number');
      expect(typeof counts.medium).toBe('number');
      expect(typeof counts.low).toBe('number');
      expect(typeof counts.total).toBe('number');
      expect(Array.isArray(data.vulnerability_details)).toBe(true);

      expect(VALID_SCAN_STATUSES.has(String(data.scan_status))).toBe(true);
      expect(data.digest).toBe(digest());

      expect(res.headers.get('X-SecureBuild-Scan_Format')).toBe('parsed');
      expect(res.headers.get('X-SecureBuild-Image_Digest')).toBe(digest());
      expect(res.headers.get('X-SecureBuild-Architecture')).toBe('amd64');
    });

    it('reads generation-specific raw and parsed documents for the selected generation', async () => {
      const parsedRes = await env.client.get(
        `/api/v1/external-image/scan?digest=${encodeURIComponent(digest())}&arch=arm64&format=parsed`,
      );
      expect(parsedRes.status).toBe(200);
      expect(parsedRes.data.counts.total).toBe(1);
      expect(Array.isArray(parsedRes.data.vulnerability_details)).toBe(true);

      const rawRes = await env.client.get(
        `/api/v1/external-image/scan?digest=${encodeURIComponent(digest())}&arch=arm64&format=raw`,
      );
      expect(rawRes.status).toBe(200);
      expect(Array.isArray(rawRes.data.matches)).toBe(true);
      expect(rawRes.data.descriptor.name).toBe('grype');
    });

    it('reads the selected generation through the batch endpoint', async () => {
      const parsedRes = await env.client.post('/api/v1/external-image/scan', {
        digests: [digest()],
        arch: 'arm64',
        format: 'parsed',
      });
      expect(parsedRes.status).toBe(200);
      expect(parsedRes.data[0].not_found).toBe(false);
      expect(parsedRes.data[0].result.counts.total).toBe(1);

      const rawRes = await env.client.post('/api/v1/external-image/scan', {
        digests: [digest()],
        arch: 'arm64',
        format: 'raw',
      });
      expect(rawRes.status).toBe(200);
      expect(rawRes.data[0].not_found).toBe(false);
      expect(Array.isArray(rawRes.data[0].result.matches)).toBe(true);
      expect(rawRes.data[0].result.descriptor.name).toBe('grype');
    });

    it('POST /scan {digests} returns array with expected shape', async () => {
      const res = await env.client.post('/api/v1/external-image/scan', {
        digests: [digest()],
        arch: 'amd64',
        format: 'parsed',
      });
      expect(res.status).toBe(200);

      const data = res.data as Record<string, unknown>[];
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);

      const entry = data[0];
      expect(entry.input).toBe(digest());
      expect(typeof entry.digest).toBe('string');
      expect(typeof entry.not_found).toBe('boolean');
      expect(entry.not_found).toBe(false);
      expect(VALID_SCAN_STATUSES.has(String(entry.scan_status))).toBe(true);
      expect(entry.result).toBeDefined();
      expect((entry.result as Record<string, unknown>).counts).toBeDefined();

      expect(res.headers.get('X-SecureBuild-Result_Count')).toBe('1');
    });

    it('POST /scan {images, format:raw} returns array with matches', async () => {
      const res = await env.client.post('/api/v1/external-image/scan', {
        images: [image()],
        arch: 'amd64',
        format: 'raw',
      });
      expect(res.status).toBe(200);

      const data = res.data as Record<string, unknown>[];
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);

      const entry = data[0];
      expect(entry.input).toBe(image());
      expect(entry.not_found).toBe(false);
      expect(entry.result).toBeDefined();
      expect(Array.isArray((entry.result as Record<string, unknown>).matches)).toBe(true);

      expect(res.headers.get('X-SecureBuild-Scan_Format')).toBe('raw');
    });

    it('POST /scan-summary {digests} returns counts', async () => {
      const res = await env.client.post('/api/v1/external-image/scan-summary', {
        digests: [SUMMARY_ONLY_DIGEST],
      });
      expect(res.status).toBe(200);

      const data = res.data as Record<string, unknown>[];
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);

      const entry = data[0];
      expect(entry.input).toBe(SUMMARY_ONLY_DIGEST);
      expect(entry.not_found).toBe(false);
      const counts = entry.counts as Record<string, unknown>;
      expect(counts.critical).toBe(2);
      expect(counts.high).toBe(3);
      expect(counts.medium).toBe(4);
      expect(counts.low).toBe(5);
      expect(counts.total).toBe(14);

      expect(res.headers.get('X-SecureBuild-Result_Count')).toBe('1');
    });

    it('serves the previous scan result while a rescan is queued', async () => {
      await env.dbPool.query(
        `UPDATE external_image_scan SET status = 'queued' WHERE digest = $1`,
        [digest()],
      );

      try {
        const getRes = await env.client.get(
          `/api/v1/external-image/scan?digest=${encodeURIComponent(digest())}&arch=amd64&format=parsed`,
        );
        expect(getRes.status).toBe(200);
        expect(getRes.data.scan_status).toBe('queued');
        expect(getRes.data.counts.high).toBe(1);
        expect(getRes.data.counts.total).toBe(1);

        const batchRes = await env.client.post('/api/v1/external-image/scan', {
          digests: [digest()],
          arch: 'amd64',
          format: 'parsed',
        });
        expect(batchRes.status).toBe(200);
        expect(batchRes.data[0].scan_status).toBe('queued');
        expect(batchRes.data[0].result.counts.high).toBe(1);
        expect(batchRes.data[0].result.counts.total).toBe(1);
      } finally {
        await env.dbPool.query(
          `UPDATE external_image_scan SET status = 'succeeded' WHERE digest = $1`,
          [digest()],
        );
      }
    });

    it('serves the previous scan result alongside a failed refresh', async () => {
      await env.dbPool.query(
        `UPDATE external_image_scan
         SET status = 'failed',
             scan_status_message = 'refresh failed',
             scan_status_updated_at = now()
         WHERE digest = $1`,
        [digest()],
      );

      try {
        const batchRes = await env.client.post('/api/v1/external-image/scan', {
          digests: [digest()],
          arch: 'amd64',
          format: 'parsed',
        });
        expect(batchRes.status).toBe(200);
        expect(batchRes.data[0].scan_status).toBe('failed');
        expect(batchRes.data[0].scan_status_message).toBe('refresh failed');
        expect(batchRes.data[0].result.counts.high).toBe(1);
        expect(batchRes.data[0].result.counts.total).toBe(1);
      } finally {
        await env.dbPool.query(
          `UPDATE external_image_scan
           SET status = 'succeeded', scan_status_message = NULL
           WHERE digest = $1`,
          [digest()],
        );
      }
    });

    it('GET /sbom?digest returns SPDX SBOM', async () => {
      const res = await env.client.get(`/api/v1/external-image/sbom?digest=${encodeURIComponent(digest())}`);
      expect(res.status).toBe(200);

      const data = res.data as Record<string, unknown>;
      expect(data.SPDXID).toBeDefined();
      expect(Array.isArray(data.packages)).toBe(true);
      expect(Array.isArray(data.relationships)).toBe(true);

      expect(res.headers.get('X-SecureBuild-Image_Digest')).toBe(digest());
    });

    it('keeps SBOMs at deterministic keys when scan results use generations', async () => {
      const removed = await env.dbPool.query(
        `DELETE FROM external_image_sbom
         WHERE digest = $1 AND arch = 'x86_64'
         RETURNING *`,
        [digest()],
      );
      const x86 = removed.rows[0];

      try {
        const res = await env.client.get(`/api/v1/external-image/sbom?digest=${encodeURIComponent(digest())}`);
        expect(res.status).toBe(200);
        expect(res.data.SPDXID).toBeDefined();
        expect(Array.isArray(res.data.packages)).toBe(true);
      } finally {
        await env.dbPool.query(
          `INSERT INTO external_image_sbom (
             digest, arch, sbom, created_at, source, image_size_bytes,
             last_security_scanned_at, image_digest, is_in_object_store
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            x86.digest,
            x86.arch,
            x86.sbom,
            x86.created_at,
            x86.source,
            x86.image_size_bytes,
            x86.last_security_scanned_at,
            x86.image_digest,
            x86.is_in_object_store,
          ],
        );
      }
    });

    it('GET /sbom?image_url returns SPDX SBOM', async () => {
      const res = await env.client.get(`/api/v1/external-image/sbom?image_url=${encodeURIComponent(image())}`);
      expect(res.status).toBe(200);

      const data = res.data as Record<string, unknown>;
      expect(data.SPDXID).toBeDefined();
      expect(Array.isArray(data.packages)).toBe(true);
      expect(Array.isArray(data.relationships)).toBe(true);
    });
  });

  describe('Phase 3 — Auth', () => {
    it('GET /scan without token returns 401', async () => {
      const res = await env.client.getNoAuth(
        `/api/v1/external-image/scan?digest=${encodeURIComponent(env.existingDigest)}&arch=amd64`,
      );
      expect(res.status).toBe(401);
    });

    it('POST /scan without token returns 401', async () => {
      const res = await env.client.postNoAuth('/api/v1/external-image/scan', {
        digests: [env.existingDigest],
      });
      expect(res.status).toBe(401);
    });

    it('POST /scan-summary without token returns 401', async () => {
      const res = await env.client.postNoAuth('/api/v1/external-image/scan-summary', {
        digests: [env.existingDigest],
      });
      expect(res.status).toBe(401);
    });

    it('GET /sbom without token returns 401', async () => {
      const res = await env.client.getNoAuth(
        `/api/v1/external-image/sbom?digest=${encodeURIComponent(env.existingDigest)}`,
      );
      expect(res.status).toBe(401);
    });

    it('GET /scan with invalid token returns 401', async () => {
      const badClient = new HttpClient(env.baseUrl, 'invalid-token');
      const res = await badClient.get(
        `/api/v1/external-image/scan?digest=${encodeURIComponent(env.existingDigest)}&arch=amd64`,
      );
      expect(res.status).toBe(401);
    });
  });
});
