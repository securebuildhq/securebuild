import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getDB } from './data/db';
import { getParam } from './data/param';
import { getS3Client } from './externalimage/blobstore';
import { isHealthy } from './health';

jest.mock('./data/db');
jest.mock('./data/param');
jest.mock('./externalimage/blobstore');

const query = jest.fn();
const release = jest.fn();
const connect = jest.fn();
const send = jest.fn();
const params: Record<string, string> = {
  DB_URI: 'postgres://private-user:private-password@private-host/db',
  R2_IMAGE_SCANS_BUCKET_NAME: 'private-bucket',
  R2_ENDPOINT: 'https://private-r2.example.com',
  R2_ACCESS_KEY: 'private-access-key',
  R2_SECRET_KEY: 'private-secret-key',
};

describe('API dependency health', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.mocked(getParam).mockImplementation(async key => params[key]);
    jest.mocked(getDB).mockReturnValue({ connect } as unknown as ReturnType<typeof getDB>);
    jest.mocked(getS3Client).mockResolvedValue({ send } as unknown as Awaited<ReturnType<typeof getS3Client>>);
    connect.mockResolvedValue({ query, release });
    query.mockResolvedValue({ rows: [{ healthy: true }] });
    send.mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('checks the shared database and a bounded bucket listing with no writes', async () => {
    expect(await isHealthy()).toBe(true);
    expect(getDB).toHaveBeenCalledWith(params.DB_URI);
    expect(query).toHaveBeenCalledWith({
      text: expect.stringContaining("current_setting('transaction_read_only')"),
      query_timeout: 2000,
    });
    expect(query.mock.calls[0][0].text).toContain('NOT pg_is_in_recovery()');
    expect(release).toHaveBeenCalledWith(false);
    const [command, options] = send.mock.calls[0];
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    expect(command.input).toEqual({ Bucket: params.R2_IMAGE_SCANS_BUCKET_NAME, MaxKeys: 1 });
    expect(options.abortSignal.aborted).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    { KeyCount: 0, IsTruncated: false },
    { Contents: [{ Key: 'private-customer/artifact.json' }], IsTruncated: true, NextContinuationToken: 'private-token' },
  ])('accepts successful listings without exposing objects or fetching more pages (%j)', async listing => {
    send.mockResolvedValue(listing);
    expect(await isHealthy()).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects a read-only or recovery database', async () => {
    query.mockResolvedValue({ rows: [{ healthy: false }] });
    expect(await isHealthy()).toBe(false);
    expect(release).toHaveBeenCalledWith(true);
    expect(warn).toHaveBeenCalledWith('API health check failed: postgres');
  });

  it('fails closed on an unexpected database result', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await isHealthy()).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reports connection acquisition failures without attempting a query', async () => {
    connect.mockRejectedValue(new Error('connection timeout: private-host'));
    expect(await isHealthy()).toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(['Query read timeout', 'connection terminated', 'password authentication failed'])(
    'discards the connection after %s', async message => {
      query.mockRejectedValue(new Error(message));
      expect(await isHealthy()).toBe(false);
      expect(release).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith(true);
    },
  );

  it.each(['NoSuchBucket', 'AccessDenied', 'network failure'])(
    'reports an R2 %s as unhealthy', async message => {
      send.mockRejectedValue(new Error(message));
      expect(await isHealthy()).toBe(false);
      expect(release).toHaveBeenCalledWith(false);
      expect(warn).toHaveBeenCalledWith('API health check failed: r2');
    },
  );

  it.each(['R2_IMAGE_SCANS_BUCKET_NAME', 'R2_ENDPOINT', 'R2_ACCESS_KEY', 'R2_SECRET_KEY'])(
    'fails closed when %s is missing', async missing => {
      jest.mocked(getParam).mockImplementation(async key => key === missing ? '' : params[key]);
      expect(await isHealthy()).toBe(false);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('aborts a stalled R2 request and releases the probe for subsequent requests', async () => {
    jest.useFakeTimers();
    send.mockImplementationOnce(() => new Promise(() => {}));
    const pending = isHealthy();
    await jest.advanceTimersByTimeAsync(1999);
    const signal = send.mock.calls[0][1].abortSignal;
    expect(signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(false);
    expect(signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(await isHealthy()).toBe(true);
  });

  it('clears the R2 timeout after a successful request', async () => {
    jest.useFakeTimers();
    expect(await isHealthy()).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('runs checks concurrently and coalesces overlapping requests only', async () => {
    let finishQuery!: (value: { rows: { healthy: boolean }[] }) => void;
    query.mockImplementationOnce(() => new Promise(resolve => { finishQuery = resolve; }));
    const first = isHealthy();
    expect(isHealthy()).toBe(first);
    // Let both checks start while PostgreSQL remains unresolved.
    await new Promise(resolve => setImmediate(resolve));
    expect(send).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    finishQuery({ rows: [{ healthy: true }] });
    expect(await first).toBe(true);

    send.mockRejectedValueOnce(new Error('R2 unavailable'));
    expect(await isHealthy()).toBe(false);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('logs only dependency names even when both errors contain secrets', async () => {
    query.mockRejectedValue(new Error(params.DB_URI));
    send.mockRejectedValue(new Error(`${params.R2_ENDPOINT}/${params.R2_SECRET_KEY}`));
    expect(await isHealthy()).toBe(false);
    expect(warn.mock.calls).toEqual([
      ['API health check failed: postgres'],
      ['API health check failed: r2'],
    ]);
  });
});
