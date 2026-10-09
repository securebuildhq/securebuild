import type { PoolClient } from 'pg';
import * as srs from 'secure-random-string';
import { encryptPassword } from './credential-crypto';
import type { TypedRegistryCredentials } from './registry';

const MAX_PULL_CREDENTIAL_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface PullCredentialContext {
  teamId: string;
  registry: string;
  imageName: string;
  credentials: TypedRegistryCredentials;
}

export async function createExternalImagePullCredential(
  client: PoolClient,
  context: PullCredentialContext,
): Promise<string> {
  const id = srs.default({ length: 24, alphanumeric: true });
  const now = new Date();
  const maxDeleteAfter = new Date(now.getTime() + MAX_PULL_CREDENTIAL_RETENTION_MS);
  const providerExpiresAt = context.credentials.type === 'ecr_authorization_token'
    ? new Date(context.credentials.expires_at)
    : null;
  const deleteAfter = providerExpiresAt && providerExpiresAt < maxDeleteAfter
    ? providerExpiresAt
    : maxDeleteAfter;
  const encryptedPassword = await encryptPassword(context.credentials.password);

  await client.query(
    `INSERT INTO external_image_pull_credential
       (id, team_id, registry, image_name, credential_type, username, password,
        provider_expires_at, delete_after, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      context.teamId,
      context.registry,
      context.imageName,
      context.credentials.type,
      context.credentials.username,
      encryptedPassword,
      providerExpiresAt,
      deleteAfter,
      now,
    ],
  );

  return id;
}
