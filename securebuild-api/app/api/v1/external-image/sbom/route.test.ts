import { NextRequest } from 'next/server';
import { getBatchExternalSboms, type BatchSbomResult } from '@/lib/externalimage/externalimage';
import { findServiceAccountWithValue } from '@/lib/team/service-account';
import * as merger from '@/lib/sbom/merger';
import { GET } from './route';

jest.mock('@/lib/externalimage/externalimage', () => ({
  getBatchExternalSboms: jest.fn(),
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

function request(): NextRequest {
  return new NextRequest('http://localhost/api/v1/external-image/sbom?digest=sha256:first&digest=sha256:second', {
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
