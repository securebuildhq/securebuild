import { parseImageRef, getImageDigest } from './registry';
import { getManifest } from '@snyk/docker-registry-v2-client';

// Mock the Snyk client
jest.mock('@snyk/docker-registry-v2-client');

describe('parseImageRef', () => {
  test('should parse docker.io/centrifugo/centrifugo:v6.2.2 correctly', () => {
    const imageUrl = 'docker.io/centrifugo/centrifugo:v6.2.2';
    const result = parseImageRef(imageUrl);

    expect(result).toEqual({
      registry: 'index.docker.io',
      repository: 'centrifugo/centrifugo',
      tag: 'v6.2.2'
    });
  });

  // Additional test cases for better coverage
  test('should handle simple Docker Hub image', () => {
    const result = parseImageRef('nginx:latest');
    expect(result).toEqual({
      registry: 'index.docker.io',
      repository: 'library/nginx',
      tag: 'latest'
    });
  });

  test('should handle image without tag', () => {
    const result = parseImageRef('nginx');
    expect(result).toEqual({
      registry: 'index.docker.io',
      repository: 'library/nginx',
      tag: 'latest'
    });
  });

  test('should handle private registry', () => {
    const result = parseImageRef('myregistry.com/myimage:v1.0');
    expect(result).toEqual({
      registry: 'myregistry.com',
      repository: 'myimage',
      tag: 'v1.0'
    });
  });

  test('should handle registry with port', () => {
    const result = parseImageRef('localhost:5000/myimage:v1.0');
    expect(result).toEqual({
      registry: 'localhost:5000',
      repository: 'myimage',
      tag: 'v1.0'
    });
  });

  test('should handle replicated proxy with content sha', () => {
    const result = parseImageRef('ec-e2e-proxy.testcluster.net/anonymous/kotsadm/kurl-proxy:v1.125.0-amd64@sha256:569dde755affbb15e55c3941ee19080b4c106e4853596d4f7d975fca92909402');
    expect(result).toEqual({
      registry: 'ec-e2e-proxy.testcluster.net',
      repository: 'anonymous/kotsadm/kurl-proxy',
      tag: 'v1.125.0-amd64',
      contentSha: 'sha256:569dde755affbb15e55c3941ee19080b4c106e4853596d4f7d975fca92909402'
    });
  });

  test('should handle ubuntu with content sha', () => {
    const result = parseImageRef('ubuntu@sha256:abc123def456');
    expect(result).toEqual({
      registry: 'index.docker.io',
      repository: 'library/ubuntu',
      tag: 'latest',
      contentSha: 'sha256:abc123def456'
    });
  });

  test('should handle content sha without tag', () => {
    const result = parseImageRef('nginx@sha256:123456789abc');
    expect(result).toEqual({
      registry: 'index.docker.io',
      repository: 'library/nginx',
      tag: 'latest',
      contentSha: 'sha256:123456789abc'
    });
  });
});

describe('getImageDigest OCI support', () => {
  const mockedGetManifest = getManifest as jest.MockedFunction<typeof getManifest>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should pass OCI Accept headers to getManifest', async () => {
    // Setup: Mock a successful response
    mockedGetManifest.mockResolvedValue({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: { mediaType: 'any', size: 1, digest: 'any' },
      layers: [],
      manifestDigest: 'sha256:test123'
    });

    // Act: Call getImageDigest
    await getImageDigest({
      registry: 'ghcr.io',
      repository: 'test/image',
      tag: 'v1'
    });

    // Assert: Verify OCI headers were included
    expect(mockedGetManifest).toHaveBeenCalledWith(
      'ghcr.io',
      'test/image',
      'v1',
      undefined,
      undefined,
      {
        acceptManifest: expect.stringMatching(/application\/vnd\.oci\.image\.manifest\.v1\+json.*application\/vnd\.oci\.image\.index\.v1\+json/)
      },
      undefined
    );
  });

  test('should fail without OCI headers when registry requires them', async () => {
    // Setup: Mock that simulates OCI-only registry behavior
    mockedGetManifest.mockImplementation(async (reg, repo, ref, u, p, options) => {
      if (!options?.acceptManifest?.includes('application/vnd.oci.image.manifest.v1+json')) {
        throw new Error('OCI index found, but Accept header does not support OCI indexes');
      }
      return {
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: { mediaType: 'any', size: 1, digest: 'any' },
        layers: [],
        manifestDigest: 'sha256:success'
      };
    });

    // Act & Assert: Should succeed with our OCI headers
    const digest = await getImageDigest({
      registry: 'ghcr.io',
      repository: 'test/image',
      tag: 'v1'
    });
    
    expect(digest).toBe('sha256:success');
  });
});

describe('getImageDigest real registry call', () => {
  test('should return correct digest for repldev/test-images:nginx-1.24.0', async () => {
    jest.setTimeout(30000);

    // Ensure we load a fresh, unmocked copy of the Snyk client and our module
    jest.resetModules();
    jest.unmock('@snyk/docker-registry-v2-client');

    const { parseImageRef, getImageDigest } = await import('./registry');
    const parsed = parseImageRef('repldev/test-images:nginx-1.24.0');
    const digest = await getImageDigest(parsed, undefined, true);
	  // this is the index digest for repldev/test-images:nginx-1.24.0, see https://hub.docker.com/repository/docker/repldev/test-images/tags/nginx-1.24.0
	  // the index digest is the most inclusive digest, and is also the digest reported for running images by the replicated SDK
    expect(digest).toBe('sha256:f6daac2445b0ce70e64d77442ccf62839f3f1b4c24bf6746a857eff014e798c8');
  });
});
