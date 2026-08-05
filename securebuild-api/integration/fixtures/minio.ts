import { MinioContainer, StartedMinioContainer } from '@testcontainers/minio';
import { S3Client, CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { gzipSync } from 'zlib';
import { SEED_BLOBS } from './seed-blobs';

export interface MinioStorage {
  container: StartedMinioContainer;
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  s3Client: S3Client;
  stop: () => Promise<void>;
}

const IMAGE_SCANS_BUCKET = 'image-scans';

function stripDigestAlgo(digest: string): string {
  const idx = digest.indexOf(':');
  if (idx !== -1) {
    return digest.substring(idx + 1);
  }
  return digest;
}

export async function setupMinio(): Promise<MinioStorage> {
  console.log('Starting MinIO container...');

  const container = await new MinioContainer('minio/minio:latest')
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(9000);
  const endpoint = `http://${host}:${port}`;
  const accessKey = container.getUsername();
  const secretKey = container.getPassword();

  console.log(`MinIO container started at ${endpoint}`);

  const s3Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    forcePathStyle: true,
  });

  // Create the image-scans bucket
  await s3Client.send(new CreateBucketCommand({ Bucket: IMAGE_SCANS_BUCKET }));

  // Upload seed blob data to MinIO
  await uploadSeedBlobs(s3Client);

  const stop = async () => {
    await container.stop();
    console.log('MinIO container stopped');
  };

  return {
    container,
    endpoint,
    accessKey,
    secretKey,
    bucket: IMAGE_SCANS_BUCKET,
    s3Client,
    stop,
  };
}

async function uploadSeedBlobs(s3Client: S3Client): Promise<void> {
  console.log('Uploading seed blobs to MinIO...');

  for (const blob of SEED_BLOBS) {
    const keyPrefix = `${stripDigestAlgo(blob.digest)}/${blob.arch}`;

    if (blob.rawResult) {
      await s3Client.send(new PutObjectCommand({
        Bucket: IMAGE_SCANS_BUCKET,
        Key: `${keyPrefix}/raw_result.json.gz`,
        Body: gzipSync(Buffer.from(blob.rawResult)),
      }));
    }

    if (blob.parsedResultsDetails) {
      await s3Client.send(new PutObjectCommand({
        Bucket: IMAGE_SCANS_BUCKET,
        Key: `${keyPrefix}/parsed_results_details.json.gz`,
        Body: gzipSync(Buffer.from(blob.parsedResultsDetails)),
      }));
    }

    if (blob.sbom) {
      await s3Client.send(new PutObjectCommand({
        Bucket: IMAGE_SCANS_BUCKET,
        Key: `${keyPrefix}/sbom.json.gz`,
        Body: gzipSync(Buffer.from(blob.sbom)),
      }));
    }
  }

  console.log(`Uploaded ${SEED_BLOBS.length} seed blobs`);
}
