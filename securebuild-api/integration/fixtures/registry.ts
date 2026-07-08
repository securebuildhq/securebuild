/**
 * Local Docker distribution registry for integration tests.
 *
 * Starts a `registry:3.0.0` container (plain HTTP, no auth) via Testcontainers
 * and pushes a minimal scratch image (config + manifest, no layers) using the
 * Docker Registry HTTP API v2. POST /external-image resolves the digest from
 * this local registry — zero external network dependencies.
 *
 * Ports the approach from the Go testutil registry
 * (integration/testutil/registry.go) but uses plain HTTP so the registry
 * client can reach it directly without TLS configuration.
 */

import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import * as crypto from 'crypto';

export interface TestRegistry {
  container: StartedTestContainer;
  host: string;
  port: number;
  baseUrl: string;
  imageUrl: string;
  digest: string;
}

function sha256hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function resolveUploadUrl(baseUrl: string, location: string, digest: string): string {
  let pathAndQuery: string;
  if (location.startsWith('http://') || location.startsWith('https://')) {
    const u = new URL(location);
    pathAndQuery = u.pathname + (u.search || '');
  } else {
    pathAndQuery = location.startsWith('/') ? location : `/${location}`;
  }
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  return `${baseUrl}${pathAndQuery}${sep}digest=${encodeURIComponent(digest)}`;
}

async function uploadBlob(baseUrl: string, repository: string, blob: Buffer, digest: string): Promise<void> {
  const postRes = await fetch(`${baseUrl}/v2/${repository}/blobs/uploads/`, { method: 'POST' });
  if (postRes.status !== 202) {
    throw new Error(`blob upload POST failed: ${postRes.status} ${await postRes.text()}`);
  }
  const location = postRes.headers.get('location');
  if (!location) {
    throw new Error('no Location header returned for blob upload');
  }

  const uploadUrl = resolveUploadUrl(baseUrl, location, digest);
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': blob.length.toString(),
    },
    body: new Uint8Array(blob),
  });
  if (putRes.status !== 201) {
    throw new Error(`blob upload PUT failed: ${putRes.status} ${await putRes.text()}`);
  }
}

/**
 * Push a minimal scratch image (config blob + schema-2 manifest, no layers)
 * to the local registry. Returns the manifest digest.
 */
async function pushScratchImage(baseUrl: string, repository: string, tag: string): Promise<string> {
  const configJson = JSON.stringify({
    architecture: 'amd64',
    os: 'linux',
    config: {},
    created: '2024-01-01T00:00:00Z',
    history: [],
    rootfs: { type: 'layers', diff_ids: [] },
  });
  const configBuf = Buffer.from(configJson, 'utf-8');
  const configDigest = `sha256:${sha256hex(configBuf)}`;
  await uploadBlob(baseUrl, repository, configBuf, configDigest);

  const manifest = {
    schemaVersion: 2,
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    config: {
      mediaType: 'application/vnd.docker.container.image.v1+json',
      size: configBuf.length,
      digest: configDigest,
    },
    layers: [],
  };
  const manifestJson = JSON.stringify(manifest);

  const manifestUrl = `${baseUrl}/v2/${repository}/manifests/${tag}`;
  const putRes = await fetch(manifestUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json' },
    body: manifestJson,
  });
  if (!putRes.ok) {
    throw new Error(`manifest PUT failed: ${putRes.status} ${await putRes.text()}`);
  }

  return `sha256:${sha256hex(Buffer.from(manifestJson, 'utf-8'))}`;
}

export async function setupTestRegistry(repository = 'test-image', tag = 'latest'): Promise<TestRegistry> {
  console.log('Starting local Docker registry container...');

  const container = await new GenericContainer('registry:3.0.0')
    .withExposedPorts(5000)
    .withWaitStrategy(Wait.forHttp('/v2/', 5000))
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5000);
  const baseUrl = `http://${host}:${port}`;

  console.log(`Local registry started at ${baseUrl}`);

  const digest = await pushScratchImage(baseUrl, repository, tag);
  const imageUrl = `${host}:${port}/${repository}:${tag}`;

  console.log(`Pushed scratch image ${imageUrl} (digest ${digest})`);

  return { container, host, port, baseUrl, imageUrl, digest };
}

export async function teardownTestRegistry(registry: TestRegistry): Promise<void> {
  console.log('Tearing down local registry...');
  await registry.container.stop();
  console.log('Local registry stopped');
}
