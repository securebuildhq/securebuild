import { parseImageRef, getImageDescriptor, getImageDigest } from './registry';
import { getImageConfig, registryCall } from '@snyk/docker-registry-v2-client';

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
  const mockedRegistryCall = registryCall as jest.MockedFunction<typeof registryCall>;
  const mockedGetImageConfig = getImageConfig as jest.MockedFunction<typeof getImageConfig>;

  function registryResponse(body: object, contentType: string, digest: string) {
    const raw = Buffer.from(JSON.stringify(body));
    return {
      body,
      raw,
      headers: {
        'content-type': contentType,
        'docker-content-digest': digest,
      },
    } as Awaited<ReturnType<typeof registryCall>>;
  }

  function imageManifest(configDigest = 'sha256:config') {
    return {
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: { mediaType: 'any', size: 1, digest: configDigest },
      layers: [],
    };
  }
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetImageConfig.mockResolvedValue({ os: 'linux', architecture: 'amd64' });
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should pass OCI Accept headers to the top-level manifest request', async () => {
    mockedRegistryCall.mockResolvedValue(registryResponse(
      imageManifest(),
      'application/vnd.oci.image.manifest.v1+json',
      'sha256:test123',
    ));

    // Act: Call getImageDigest
    await getImageDigest({
      registry: 'ghcr.io',
      repository: 'test/image',
      tag: 'v1'
    });

    // Assert: Verify OCI headers were included
    expect(mockedRegistryCall).toHaveBeenCalledWith(
      'ghcr.io/v2/test/image/manifests/v1',
      undefined,
      undefined,
      expect.objectContaining({
        headers: {
          Accept: expect.stringMatching(/application\/vnd\.oci\.image\.manifest\.v1\+json.*application\/vnd\.oci\.image\.index\.v1\+json/),
        },
      }),
    );
  });

  test('should fail without OCI headers when registry requires them', async () => {
    // Setup: Mock that simulates OCI-only registry behavior
    mockedRegistryCall.mockImplementation(async (_uri, _username, _password, options) => {
      if (!options?.headers?.Accept?.includes('application/vnd.oci.image.manifest.v1+json')) {
        throw new Error('OCI index found, but Accept header does not support OCI indexes');
      }
      return registryResponse(
        imageManifest(),
        'application/vnd.oci.image.manifest.v1+json',
        'sha256:success',
      );
    });

    // Act & Assert: Should succeed with our OCI headers
    const digest = await getImageDigest({
      registry: 'ghcr.io',
      repository: 'test/image',
      tag: 'v1'
    });

    expect(digest).toBe('sha256:success');
  });

  test('should use http protocol for local registries', async () => {
    mockedRegistryCall.mockResolvedValue(registryResponse(
      imageManifest(),
      'application/vnd.docker.distribution.manifest.v2+json',
      'sha256:local123',
    ));

    await getImageDigest({
      registry: 'localhost:5555',
      repository: 'test/image',
      tag: 'v1'
    });

    expect(mockedRegistryCall).toHaveBeenCalledWith(
      'localhost:5555/v2/test/image/manifests/v1',
      undefined,
      undefined,
      expect.objectContaining({ protocol: 'http:' }),
    );
  });

  test('discovers only arm64 for a single-platform arm image', async () => {
    mockedRegistryCall.mockResolvedValue(registryResponse(
      imageManifest('sha256:arm-config'),
      'application/vnd.oci.image.manifest.v1+json',
      'sha256:arm-manifest',
    ));
    mockedGetImageConfig.mockResolvedValue({ os: 'linux', architecture: 'arm64' });

    await expect(getImageDescriptor({
      registry: 'ghcr.io',
      repository: 'test/image',
      tag: 'arm',
    })).resolves.toEqual({
      digest: 'sha256:arm-manifest',
      architectures: ['aarch64'],
    });
    expect(mockedRegistryCall).toHaveBeenCalledTimes(1);
  });

  test('discovers supported architectures directly from a multi-architecture index', async () => {
    mockedRegistryCall.mockResolvedValue(registryResponse({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: [
        { platform: { os: 'linux', architecture: 'amd64' } },
        { platform: { os: 'linux', architecture: 'arm', variant: 'v6' } },
        { platform: { os: 'linux', architecture: 'arm', variant: 'v7' } },
        { platform: { os: 'linux', architecture: 'arm64', variant: 'v8' } },
        { platform: { os: 'linux', architecture: 'arm64', variant: 'v9' } },
        { platform: { os: 'linux', architecture: 'ppc64le' } },
        { platform: { os: 'linux', architecture: 'riscv64' } },
        { platform: { os: 'linux', architecture: 's390x' } },
        { platform: { os: 'windows', architecture: 'amd64' } },
        { platform: { os: 'unknown', architecture: 'unknown' } },
      ],
    }, 'application/vnd.oci.image.index.v1+json', 'sha256:index'));

    await expect(getImageDescriptor({
      registry: 'ghcr.io',
      repository: 'test/image',
      tag: 'multi',
    })).resolves.toEqual({
      digest: 'sha256:index',
      architectures: ['x86_64', 'aarch64'],
    });
    expect(mockedRegistryCall).toHaveBeenCalledTimes(1);
    expect(mockedGetImageConfig).not.toHaveBeenCalled();
  });
});
