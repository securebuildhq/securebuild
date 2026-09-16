import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getDB } from './data/db';
import { getParam } from './data/param';
import { getS3Client } from './externalimage/blobstore';

const CHECK_TIMEOUT_MS = 2000;

async function checkPostgres(): Promise<void> {
  // The shared pool already bounds connection acquisition to two seconds.
  const client = await getDB(await getParam('DB_URI')).connect();
  let discardClient = false;
  try {
    // pg supports a per-query timeout, although QueryConfig omits that field.
    const query = {
      text: `SELECT NOT pg_is_in_recovery()
        AND current_setting('transaction_read_only') = 'off' AS healthy`,
      query_timeout: CHECK_TIMEOUT_MS,
    };
    const result = await client.query<{ healthy: boolean }>(query);
    // Authentication updates last_used_at, so a read-only DB is not usable.
    if (result.rows[0]?.healthy !== true) {
      throw new Error('Postgres is not writable');
    }
  } catch (error) {
    // query_timeout only rejects the caller; close the connection as well so
    // a stalled query cannot continue occupying a pooled connection.
    discardClient = true;
    throw error;
  } finally {
    client.release(discardClient);
  }
}

async function checkR2(): Promise<void> {
  const [bucket, endpoint, accessKey, secretKey] = await Promise.all([
    getParam('R2_IMAGE_SCANS_BUCKET_NAME'),
    getParam('R2_ENDPOINT'),
    getParam('R2_ACCESS_KEY'),
    getParam('R2_SECRET_KEY'),
  ]);
  if (!bucket || !endpoint || !accessKey || !secretKey) {
    throw new Error('R2 is not configured');
  }

  const client = await getS3Client();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      // A single bounded listing also succeeds for an empty bucket. Discard
      // the result: object names/metadata must never reach the public response.
      client.send(new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 1,
      }), { abortSignal: controller.signal }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('R2 health check timed out'));
        }, CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function runChecks(): Promise<boolean> {
  const results = await Promise.allSettled([checkPostgres(), checkR2()]);
  const dependencies = ['postgres', 'r2'];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      // Never log raw dependency errors: they can contain credentials/URLs.
      console.warn(`API health check failed: ${dependencies[index]}`);
    }
  });
  return results.every(result => result.status === 'fulfilled');
}

let inFlight: Promise<boolean> | undefined;

export function isHealthy(): Promise<boolean> {
  // Share overlapping public probes without caching completed results.
  if (!inFlight) {
    inFlight = runChecks().finally(() => { inFlight = undefined; });
  }
  return inFlight;
}
