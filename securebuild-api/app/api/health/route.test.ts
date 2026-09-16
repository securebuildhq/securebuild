import { isHealthy } from '@/lib/health';
import { GET } from './route';

jest.mock('@/lib/health');

describe('GET /api/health', () => {
  beforeEach(() => jest.resetAllMocks());

  it.each([
    [true, 200, 'healthy'],
    [false, 503, 'unhealthy'],
  ] as const)('returns only aggregate health without authentication (%s)', async (healthy, status, bodyStatus) => {
    jest.mocked(isHealthy).mockResolvedValue(healthy);
    // No request, credentials, or authentication lookup is required.
    const response = await GET();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ status: bodyStatus });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('checks health again on subsequent requests', async () => {
    jest.mocked(isHealthy).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await GET()).status).toBe(200);
    expect((await GET()).status).toBe(503);
    expect(isHealthy).toHaveBeenCalledTimes(2);
  });
});
