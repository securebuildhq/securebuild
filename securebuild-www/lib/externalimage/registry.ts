
import { getManifest } from '@snyk/docker-registry-v2-client';
import { ECRClient, GetAuthorizationTokenCommand } from '@aws-sdk/client-ecr';
import { ECRPUBLICClient, GetAuthorizationTokenCommand as GetAuthorizationTokenCommandPublic } from '@aws-sdk/client-ecr-public';

interface ImageRef {
  registry: string;
  repository: string;
  tag: string;
  contentSha?: string;
}

interface Credentials {
  username?: string;
  password?: string;
}

function isDockerHub(registry: string): boolean {
  return registry === 'docker.io' || registry === 'index.docker.io';
}

// Check if registry is a private ECR endpoint
function isPrivateECRRegistry(registry: string): boolean {
  return registry.includes('.dkr.ecr.') && registry.endsWith('.amazonaws.com');
}

// Check if registry is AWS ECR Public
function isPublicECRRegistry(registry: string): boolean {
  return registry === 'public.ecr.aws';
}

// Check if registry is any type of ECR (private or public)
function isECRRegistry(registry: string): boolean {
  return isPrivateECRRegistry(registry) || isPublicECRRegistry(registry);
}

// Parse ECR endpoint to extract registry ID and region
function parseECREndpoint(endpoint: string): { registryId: string; region: string } {
  const parts = endpoint.split('.');
  if (parts.length < 6 || parts[1] !== 'dkr' || parts[2] !== 'ecr') {
    throw new Error(`Invalid ECR endpoint format: ${endpoint}`);
  }
  return { registryId: parts[0], region: parts[3] };
}

// Exchange AWS credentials for ECR Public authorization token
async function getPublicECRCredentials(accessKeyId: string, secretAccessKey: string): Promise<Credentials> {
  const client = new ECRPUBLICClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const command = new GetAuthorizationTokenCommandPublic({});
  const response = await client.send(command);

  // ECR Public returns authorizationData as an object (not an array)
  if (!response.authorizationData?.authorizationToken) {
    throw new Error('No authorization token returned for ECR Public');
  }

  const decoded = Buffer.from(response.authorizationData.authorizationToken, 'base64').toString('utf-8');
  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) {
    throw new Error('Invalid ECR Public token format');
  }
  const username = decoded.substring(0, colonIndex);
  const password = decoded.substring(colonIndex + 1);

  return { username, password };
}

// Exchange AWS credentials for private ECR authorization token
async function getPrivateECRCredentials(registry: string, accessKeyId: string, secretAccessKey: string): Promise<Credentials> {
  const { registryId, region } = parseECREndpoint(registry);

  const client = new ECRClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const command = new GetAuthorizationTokenCommand({
    registryIds: [registryId],
  });

  const response = await client.send(command);

  // Private ECR returns authorizationData as an array
  if (!response.authorizationData || response.authorizationData.length === 0) {
    throw new Error(`No authorization data returned for private ECR registry ${registry}`);
  }

  const authToken = response.authorizationData[0]?.authorizationToken;
  if (!authToken) {
    throw new Error(`No authorization token in private ECR response for ${registry}`);
  }

  const decoded = Buffer.from(authToken, 'base64').toString('utf-8');
  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) {
    throw new Error('Invalid ECR token format');
  }
  const username = decoded.substring(0, colonIndex);
  const password = decoded.substring(colonIndex + 1);

  return { username, password };
}

// Exchange AWS credentials for ECR token (wrapper that handles both private and public ECR)
async function getECRCredentials(registry: string, accessKeyId: string, secretAccessKey: string): Promise<Credentials> {
  if (isPublicECRRegistry(registry)) {
    return getPublicECRCredentials(accessKeyId, secretAccessKey);
  } else {
    return getPrivateECRCredentials(registry, accessKeyId, secretAccessKey);
  }
}

// Get credentials for a registry, exchanging AWS creds for ECR token if needed
async function getCredentialsForRegistry(registry: string, credentials?: Credentials): Promise<Credentials | undefined> {
  // If image-specific credentials are provided, use them (even if partial - let auth fail naturally)
  if (credentials?.username || credentials?.password) {
    // For ECR registries with complete credentials, exchange AWS credentials for ECR token
    // Skip if username is "AWS" (already an ECR token)
    if (isECRRegistry(registry) && credentials.username && credentials.password && credentials.username !== 'AWS') {
      return getECRCredentials(registry, credentials.username, credentials.password);
    }
    return credentials;
  }

  // Fallback: Use default AWS credentials for public ECR to avoid rate limiting
  // Only applies when NO image-specific credentials were provided
  if (isPublicECRRegistry(registry)) {
    const defaultAccessKeyId = process.env.AWS_ECR_PUBLIC_ACCESS_KEY_ID;
    const defaultSecretKey = process.env.AWS_ECR_PUBLIC_SECRET_ACCESS_KEY;

    if (defaultAccessKeyId && defaultSecretKey) {
      console.log('Using default AWS credentials for ECR Public (higher rate limits)');
      return getECRCredentials(registry, defaultAccessKeyId, defaultSecretKey);
    }
  }

  return undefined;
}

// Check if the first part of a path looks like a registry (has a dot or colon)
function looksLikeRegistry(part: string): boolean {
  return part.includes('.') || part.includes(':');
}

export function parseImageRef(imageUrl: string): ImageRef {
  let registry = 'index.docker.io';
  let repository: string;
  let tag = 'latest';
  let contentSha: string | undefined;

  // Handle content digest (SHA) if present
  if (imageUrl.includes('@')) {
    const atIndex = imageUrl.indexOf('@');
    contentSha = imageUrl.substring(atIndex + 1);
    imageUrl = imageUrl.substring(0, atIndex);
  }

  // Handle tag if present (last colon that's not part of a port)
  const lastColonIndex = imageUrl.lastIndexOf(':');
  if (lastColonIndex !== -1) {
    const afterColon = imageUrl.substring(lastColonIndex + 1);
    // If afterColon doesn't contain a slash, it's a tag (not a port in registry:port/repo)
    if (!afterColon.includes('/')) {
      tag = afterColon;
      imageUrl = imageUrl.substring(0, lastColonIndex);
    }
  }

  // Now split by slash and check if first part is a registry
  const parts = imageUrl.split('/');

  if (parts.length >= 2 && looksLikeRegistry(parts[0])) {
    // First part is a registry (e.g., "gcr.io/repo" or "registry:5000/repo")
    registry = parts[0];
    repository = parts.slice(1).join('/');

    // Normalize docker.io to index.docker.io
    if (registry === 'docker.io') {
      registry = 'index.docker.io';
    }

    // For Docker Hub, add "library/" prefix for official images (single-part names)
    if (isDockerHub(registry) && !repository.includes('/')) {
      repository = `library/${repository}`;
    }
  } else if (parts.length === 1 && looksLikeRegistry(parts[0])) {
    // Just a registry hostname with no repo path - invalid input
    throw new Error(`Invalid image reference: "${imageUrl}" appears to be a registry hostname. Please include the repository path (e.g., "${imageUrl}/repo/image:tag")`);
  } else {
    // No registry specified, use Docker Hub
    repository = imageUrl;

    // For Docker Hub, add "library/" prefix for official images (single-part names)
    if (!repository.includes('/')) {
      repository = `library/${repository}`;
    }
  }

  return { registry, repository, tag, contentSha };
}

export async function getImageDigest(parsed: ImageRef, credentials?: Credentials, hideLogs?: boolean): Promise<string> {
  console.log(`Getting digest(s) for ${parsed.registry}/${parsed.repository}:${parsed.tag}`);

  try {
    // Get the manifest reference (SHA or tag)
    const manifestRef = parsed.contentSha || parsed.tag;
    console.log(`Fetching manifest for ${parsed.repository}:${manifestRef} from ${parsed.registry}`);

    // Get appropriate credentials (exchange AWS creds for ECR token if needed)
    const resolvedCredentials = await getCredentialsForRegistry(parsed.registry, credentials);
    const username = resolvedCredentials?.username;
    const password = resolvedCredentials?.password;

    if (!hideLogs) {
      if (username && password) {
        console.log('Using username/password authentication');
      } else {
        console.log('Using anonymous access');
      }
    }

    // Get the manifest using Snyk client
    const manifest = await getManifest(
      parsed.registry,
      parsed.repository,
      manifestRef,
      username,
      password,
      {
        acceptManifest: [
          'application/vnd.docker.distribution.manifest.v2+json',
          'application/vnd.docker.distribution.manifest.list.v2+json',
          'application/vnd.oci.image.manifest.v1+json',
          'application/vnd.oci.image.index.v1+json'
        ].join(', ')
      },
      undefined
    );
    
    // the index digest is the most inclusive digest that contains all the platform digests
    if (manifest.indexDigest) {
      if (!hideLogs) {
        console.log(`Retrieved index digest: ${manifest.indexDigest}`);
      }
      return manifest.indexDigest;
    }
    
    // fallback to the manifest digest if the index digest is not available
    if (manifest.manifestDigest) {
      if (!hideLogs) {
        console.log(`Retrieved digest: ${manifest.manifestDigest}`);
      }
      return manifest.manifestDigest;
    }

    throw new Error('Unable to determine manifest digest');
  } catch (error) {
    console.error(`getImageDigest error:`, error);
    throw new Error(`Failed to get image digest for ${parsed.registry}/${parsed.repository}:${parsed.tag}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

