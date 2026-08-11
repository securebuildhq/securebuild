import * as path from 'path';
import { Client } from 'pg';
import { setupTestEnvironment, TestEnvironment } from '../../../fixtures/environment';

const DIGEST_WITH_STALE_SCAN = 'sha256:stale1234567890123456789012345678901234567890123456789012345';

/**
 * Integration tests for the on-demand scan trigger (Part 3).
 *
 * When a client requests scan results via GET /scan or GET /external-image and
 * the image's last scan is older than 4 hours (stale) and not currently
 * queued/running, the API enqueues an external_image_scan work queue message
 * and returns scan_started_at.
 *
 * Stale image:    API request enqueues work + returns scan_started_at.
 * Non-stale image: API request does NOT enqueue work, returns existing results.
 *
 * Uses a pg Client listening on the external_image_scan channel to validate
 * that the correct payload is received (or not received) without querying
 * the work_queue table directly.
 *
 * Runs against a local Testcontainers stack using real HTTP requests.
 */
describe('On-demand scan trigger', () => {
  let env: TestEnvironment;
  let listenClient: Client;

  beforeAll(async () => {
    const seedDataDir = path.join(__dirname, 'seed-data');
    env = await setupTestEnvironment(seedDataDir);

    // Connect a dedicated pg client and start listening on the scan channel.
    // This captures NOTIFY messages sent by EnqueueScanForDigest.
    // The client stays connected for the lifetime of the test suite.
    listenClient = new Client({ connectionString: env.connectionString });
    await listenClient.connect();
    await listenClient.query('LISTEN external_image_scan');
  });

  afterAll(async () => {
    if (listenClient) {
      try { await listenClient.query('UNLISTEN external_image_scan'); } catch {}
      try { await listenClient.end(); } catch {}
    }
    await env.teardown();
  });

  /**
   * Helper: listen for the next external_image_scan notification and resolve
   * with the payload from the work_queue row, or null if none arrives within
   * the timeout. Must be called before the action that triggers the notify.
   */
  async function waitForScanNotification(
    timeoutMs: number,
  ): Promise<{ digest: string } | null> {
    return new Promise((resolve) => {
      let settled = false;

      const cleanup = () => {
        listenClient.off('notification', onNotification);
      };

      const onNotification = async (msg: { channel: string; payload: string }) => {
        if (msg.channel !== 'external_image_scan' || settled) return;
        settled = true;
        cleanup();

        // The notification payload is the work_queue row ID.
        // Fetch the actual payload (with digest) from the work_queue table.
        try {
          const result = await env.dbPool.query(
            `SELECT payload FROM work_queue WHERE id = $1`,
            [msg.payload]
          );
          if (result.rows.length > 0) {
            const row = result.rows[0];
            const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
            resolve({ digest: payload.digest });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      };

      listenClient.on('notification', onNotification);

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(null);
        }
      }, timeoutMs);
      timer.unref();
    });
  }

  /**
   * Start listening for a scan notification, then call the action.
   * This ensures the listener is registered before the notify is sent.
   */
  async function expectScanNotification(
    digest: string,
    action: () => Promise<void>,
  ) {
    const notificationPromise = waitForScanNotification(5000);
    await action();
    const notification = await notificationPromise;
    expect(notification).not.toBeNull();
    expect(notification!.digest).toBe(digest);
  }

  /**
   * Start listening, call the action, and verify no notification arrives.
   */
  async function expectNoScanNotification(
    action: () => Promise<void>,
  ) {
    const notificationPromise = waitForScanNotification(3000);
    await action();
    const notification = await notificationPromise;
    expect(notification).toBeNull();
  }

  describe('Stale image (scan >4h old)', () => {
    const digest = () => DIGEST_WITH_STALE_SCAN;

    it('GET /scan enqueues work queue message with correct digest payload', async () => {
      // The seeded scan for this digest has scan_completed_at = 2024-01-01
      // which is >4h ago, so EnqueueScanForDigest should trigger.
      await expectScanNotification(digest(), async () => {
        const res = await env.client.get(
          `/api/v1/external-image/scan?digest=${encodeURIComponent(digest())}&arch=amd64&format=parsed`,
        );
        expect(res.status).toBe(200);

        const data = res.data as Record<string, unknown>;
        expect(data.scan_started_at).toBeDefined();
        expect(data.scan_started_at).not.toBeNull();
      });
    });

    it('GET /external-image returns scan_started_at', async () => {
      // Note: the first test already enqueued a scan for this digest,
      // so the scan status is now 'queued'. EnqueueScanForDigest will
      // detect the in-progress scan and return the existing scan_attempted_at
      // without enqueuing a new notification.
      const res = await env.client.get(
        `/api/v1/external-image?sha=${encodeURIComponent(digest())}`,
      );
      expect(res.status).toBe(200);

      const data = res.data as Record<string, unknown>;
      expect(data.scan_started_at).toBeDefined();
      expect(data.scan_started_at).not.toBeNull();
    });
  });

  describe('Non-stale image (scan within 4h)', () => {
    const digest = () => env.existingDigest;

    it('GET /scan does NOT enqueue a new work queue message', async () => {
      await expectNoScanNotification(async () => {
        const res = await env.client.get(
          `/api/v1/external-image/scan?digest=${encodeURIComponent(digest())}&arch=amd64&format=parsed`,
        );
        expect(res.status).toBe(200);
      });
    });
  });
});
