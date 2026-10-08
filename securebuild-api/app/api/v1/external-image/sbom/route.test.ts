import { NextRequest } from 'next/server';
import { getBatchExternalSboms, getExternalImageSBOM, teamOwnsDigest, type BatchSbomResult } from '@/lib/externalimage/externalimage';
import { findServiceAccountWithValue } from '@/lib/team/service-account';
import * as merger from '@/lib/sbom/merger';
import { GET } from './route';

jest.mock('@/lib/externalimage/externalimage', () => ({
  getBatchExternalSboms: jest.fn(),
  getExternalImageSBOM: jest.fn(),
  teamOwnsDigest: jest.fn(),
}));
jest.mock('@/lib/externalimage/registry', () => ({ parseImageRef: jest.fn() }));
jest.mock('@/lib/team/service-account', () => ({ findServiceAccountWithValue: jest.fn() }));
jest.mock('@/lib/observability/tracing', () => ({
  withTrace: (_name: string, fn: () => unknown) => fn(),
  traceFunction: (_name: string, fn: unknown) => fn,
}));

function sbom(name: string): string {
  return JSON.stringify({
    SPDXID: 'SPDXRef-DOCUMENT',
    name,
    dataLicense: 'CC0-1.0',
    creationInfo: { created: '2026-10-05T00:00:00Z', creators: ['Tool: test'] },
    spdxVersion: 'SPDX-2.3',
    documentNamespace: `https://example.com/${name}`,
    packages: [{
      SPDXID: `SPDXRef-${name}`,
      name,
      versionInfo: '1.0',
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      description: 'Unicode text: café 日本語',
    }],
    relationships: [{
      spdxElementId: 'SPDXRef-DOCUMENT',
      relationshipType: 'DESCRIBES',
      relatedSpdxElement: `SPDXRef-${name}`,
    }],
  }, null, 2);
}

function result(digest: string, body: string | null): BatchSbomResult {
  return {
    digest, arch: 'x86_64', sbom: body, source: 'syft',
    sbomCreatedAt: null, imageSizeBytes: 0, hasAccess: true,
  };
}

function request(arch?: string): NextRequest {
  const architectureQuery = arch ? `&arch=${encodeURIComponent(arch)}` : '';
  return new NextRequest(`http://localhost/api/v1/external-image/sbom?digest=sha256:first&digest=sha256:second${architectureQuery}`, {
    headers: { Authorization: 'Bearer test-token' },
  });
}

function singleRequest(arch?: string): NextRequest {
  const architectureQuery = arch ? `&arch=${encodeURIComponent(arch)}` : '';
  return new NextRequest(`http://localhost/api/v1/external-image/sbom?digest=sha256:first${architectureQuery}`, {
    headers: { Authorization: 'Bearer test-token' },
  });
}

describe('batch SBOM response', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.mocked(findServiceAccountWithValue).mockResolvedValue({
      teamId: 'test-team',
      serviceAccount: {
        id: 'test-account', name: 'test', createdAt: new Date(),
        expiresAt: null, expiresIn: null, lastUsedAt: null,
        partialValue: 'test', isSystem: false,
      },
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the serialized merged document verbatim with JSON and image headers', async () => {
    jest.mocked(getBatchExternalSboms).mockResolvedValue(new Map([
      ['sha256:first', result('sha256:first', sbom('first'))],
      ['sha256:second', result('sha256:second', sbom('second'))],
    ]));
    const merge = jest.spyOn(merger, 'mergeSBOMs');

    const response = await GET(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(body).toBe(merge.mock.results[0].value);
    const document = JSON.parse(body);
    expect(document.name).toBe('Combined SBOM');
    expect(document.packages.map((pkg: merger.SPDXPackage) => pkg.name)).toEqual(['first', 'second']);
    expect(document.packages[0].description).toBe('Unicode text: café 日本語');
    expect(document.relationships.map((rel: merger.SPDXRelationship) => rel.relatedSpdxElement))
      .toEqual(document.packages.map((pkg: merger.SPDXPackage) => pkg.SPDXID));
    expect(response.headers.get('X-SecureBuild-Image_Count')).toBe('2');
    expect(response.headers.get('X-SecureBuild-Image_Digest')).toBe('sha256:first,sha256:second');
    expect(response.headers.get('X-SecureBuild-SBOM_Source')).toBe('syft,syft');
    expect(getBatchExternalSboms).toHaveBeenCalledWith(
      'test-team',
      ['sha256:first', 'sha256:second'],
      'x86_64',
    );
  });

  it('returns merged SBOMs for the requested architecture', async () => {
    jest.mocked(getBatchExternalSboms).mockResolvedValue(new Map([
      ['sha256:first', result('sha256:first', sbom('first-arm64'))],
      ['sha256:second', result('sha256:second', sbom('second-arm64'))],
    ]));

    const response = await GET(request('arm64'));

    expect(response.status).toBe(200);
    expect(response.headers.get('X-SecureBuild-Architecture')).toBe('arm64');
    expect(getBatchExternalSboms).toHaveBeenCalledWith(
      'test-team',
      ['sha256:first', 'sha256:second'],
      'aarch64',
    );
  });

  it('returns a single SBOM for the requested architecture without falling back', async () => {
    jest.mocked(teamOwnsDigest).mockResolvedValue(true);
    jest.mocked(getExternalImageSBOM).mockResolvedValue({
      sbom: sbom('single-arm64'),
      source: 'syft',
    });

    const response = await GET(singleRequest('arm64'));

    expect(response.status).toBe(200);
    expect(response.headers.get('X-SecureBuild-Architecture')).toBe('arm64');
    expect(getExternalImageSBOM).toHaveBeenCalledWith('sha256:first', 'aarch64');
  });

  it('returns 404 instead of falling back when the requested architecture is unavailable', async () => {
    jest.mocked(teamOwnsDigest).mockResolvedValue(true);
    jest.mocked(getExternalImageSBOM).mockResolvedValue(null);

    const response = await GET(singleRequest('arm64'));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'SBOM not found' });
    expect(getExternalImageSBOM).toHaveBeenCalledWith('sha256:first', 'aarch64');
  });

  it('preserves the legacy single-image fallback when architecture is omitted', async () => {
    jest.mocked(teamOwnsDigest).mockResolvedValue(true);
    jest.mocked(getExternalImageSBOM).mockResolvedValue({
      sbom: sbom('legacy-default'),
      source: 'syft',
    });

    const response = await GET(singleRequest());

    expect(response.status).toBe(200);
    expect(response.headers.has('X-SecureBuild-Architecture')).toBe(false);
    expect(getExternalImageSBOM).toHaveBeenCalledWith('sha256:first', undefined);
  });

  it('rejects an unsupported architecture', async () => {
    const response = await GET(request('s390x'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid architecture. Supported: amd64, arm64',
    });
    expect(getBatchExternalSboms).not.toHaveBeenCalled();
  });

  it('returns the available SBOM verbatim when another requested SBOM is missing', async () => {
    const body = sbom('first');
    jest.mocked(getBatchExternalSboms).mockResolvedValue(new Map([
      ['sha256:first', result('sha256:first', body)],
      ['sha256:second', result('sha256:second', null)],
    ]));

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
    expect(response.headers.get('X-SecureBuild-Image_Count')).toBe('1');
    expect(response.headers.get('X-SecureBuild-Image_Digest')).toBe('sha256:first');
    expect(response.headers.get('X-SecureBuild-SBOM_Source')).toBe('syft');
  });

  it('returns a JSON 404 when no requested SBOM is available', async () => {
    jest.mocked(getBatchExternalSboms).mockResolvedValue(new Map());

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'No SBOMs found for the requested images' });
  });

  it('returns a JSON 500 when the only available SBOM has malformed JSON', async () => {
    jest.mocked(getBatchExternalSboms).mockResolvedValue(new Map([
      ['sha256:first', result('sha256:first', '{invalid JSON')],
      ['sha256:second', result('sha256:second', null)],
    ]));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.json()).toEqual({ error: 'Failed to merge SBOMs' });
    expect(response.headers.has('X-SecureBuild-Image_Count')).toBe(false);
  });

  it('returns a JSON 500 when merging fails', async () => {
    jest.mocked(getBatchExternalSboms).mockResolvedValue(new Map([
      ['sha256:first', result('sha256:first', sbom('first'))],
      ['sha256:second', result('sha256:second', '{invalid JSON')],
    ]));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to merge SBOMs' });
  });
});
