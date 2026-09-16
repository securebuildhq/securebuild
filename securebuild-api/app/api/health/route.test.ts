import { isHealthy } from '@/lib/health';
import { GET } from './route';

jest.mock('@/lib/health');

describe('GET /api/health', () => {
  beforeEach(() => jest.resetAllMocks());

  it.each([
    [true, 200, 'healthy'],
    [false, 503, 'unhealthy'],
  ] as const)('returns the expected HTTP status, minimal JSON body, and no-store header (%s)', async (healthy, status, bodyStatus) => {
    jest.mocked(isHealthy).mockResolvedValue(healthy);
    const response = await GET();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ status: bodyStatus });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
});
