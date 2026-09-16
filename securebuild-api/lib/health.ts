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
  const keys = ['R2_IMAGE_SCANS_BUCKET_NAME', 'R2_ENDPOINT', 'R2_ACCESS_KEY', 'R2_SECRET_KEY'] as const;
  const values = await Promise.all(keys.map(key => getParam(key)));
  const missing = keys.filter((_, index) => !values[index]);
  if (missing.length > 0) {
    throw new Error(`Missing R2 configuration: ${missing.join(', ')}`);
  }
  const [bucket] = values;

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
          // Preserve the timeout explanation even if abort rejects send().
          reject(new Error('R2 health check timed out'));
          controller.abort();
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
      // Keep the full error in server logs; callers only receive aggregate health.
      console.warn(`API health check failed: ${dependencies[index]}`, result.reason);
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
