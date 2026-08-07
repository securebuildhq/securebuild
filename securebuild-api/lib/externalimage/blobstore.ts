import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getDB } from '../data/db';
import { getParam } from '../data/param';

let s3Client: S3Client | null = null;

async function getS3Client(): Promise<S3Client> {
  if (s3Client) {
    return s3Client;
  }

  const [accessKey, secretKey, endpoint] = await Promise.all([
    getParam('R2_ACCESS_KEY'),
    getParam('R2_SECRET_KEY'),
    getParam('R2_ENDPOINT'),
  ]);

  s3Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    forcePathStyle: true,
  });

  return s3Client;
}

function stripDigestAlgo(digest: string): string {
  const idx = digest.indexOf(':');
  if (idx !== -1) {
    return digest.substring(idx + 1);
  }
  return digest;
}

let cachedDynamicFolder: string | null = null;

async function getDynamicFolder(): Promise<string> {
  if (cachedDynamicFolder !== null) {
    return cachedDynamicFolder;
  }

  const useDynamic = await getParam('R2_USE_DYNAMIC_FOLDER');
  if (useDynamic !== 'true') {
    cachedDynamicFolder = '';
    return '';
  }

  // Fetch r2_directory from the dynamic_config table — same source as the Go R2Client
  const db = getDB(await getParam('DB_URI'));
  const result = await db.query('SELECT value FROM dynamic_config WHERE key = $1', ['r2_directory']);
  const folderValue = result.rows.length > 0 ? result.rows[0].value : '';
  const folder = folderValue ?? '';
  cachedDynamicFolder = folder;
  return folder;
}
async function getObjectKey(digest: string, arch: string, filename: string): Promise<string> {
  const folder = await getDynamicFolder();
  const prefix = folder ? `${folder}/` : '';
  return `${prefix}${stripDigestAlgo(digest)}/${arch}/${filename}`;
}

async function fetchAndDecompress(key: string, bucket: string): Promise<string> {
  const client = await getS3Client();
  const response = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));

  if (!response.Body) {
    throw new Error(`object ${key} has no body`);
  }

  const compressed = await response.Body.transformToByteArray();
  const decompressed = await decompressGzip(compressed);
  return new TextDecoder().decode(decompressed);
}

// Minimal gzip decompression using Web APIs (CompressionStream)
async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.buffer as ArrayBuffer]).stream();
  const decompressed = stream.pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(decompressed).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function getRawResult(digest: string, arch: string): Promise<string> {
  const bucket = await getParam('R2_IMAGE_SCANS_BUCKET_NAME');
  const key = await getObjectKey(digest, arch, 'raw_result.json.gz');
  return fetchAndDecompress(key, bucket);
}

export async function getParsedResultsDetails(digest: string, arch: string): Promise<string> {
  const bucket = await getParam('R2_IMAGE_SCANS_BUCKET_NAME');
  const key = await getObjectKey(digest, arch, 'parsed_results_details.json.gz');
  return fetchAndDecompress(key, bucket);
}

export async function getSBOM(digest: string, arch: string): Promise<string> {
  const bucket = await getParam('R2_IMAGE_SCANS_BUCKET_NAME');
  const key = await getObjectKey(digest, arch, 'sbom.json.gz');
  return fetchAndDecompress(key, bucket);
}
