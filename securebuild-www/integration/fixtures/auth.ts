import { Pool } from 'pg';
import srs from 'secure-random-string';
import { generateServiceAccountToken } from '../../lib/team/token';

/**
 * Interface for test service account data
 */
export interface TestServiceAccount {
  id: string;
  name: string;
  token: string; // Raw token value for API authentication
  partialValue: string;
  teamId: string;
}

/**
 * Creates a test service account with a token for API authentication
 *
 * Note: This function expects teams to already exist in the database
 * (typically via SchemaHero seed data in *.seed.yaml files)
 *
 * This function uses the production generateServiceAccountToken() function
 * to create tokens exactly as they would be in production.
 *
 * @param pool - PostgreSQL connection pool
 * @param teamId - Team ID to associate the service account with
 * @param name - Service account name (default: "Test Service Account")
 * @returns TestServiceAccount with the created service account and raw token
 */
export async function createTestServiceAccount(
  pool: Pool,
  teamId: string,
  name: string = 'Test Service Account'
): Promise<TestServiceAccount> {
  // Generate token using production function
  const { token: rawToken, hash, partialValue } = generateServiceAccountToken();

  const id = `sa-${srs({ length: 12, alphanumeric: true })}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
  const expiresIn = '30';

  await pool.query(
    `
      INSERT INTO service_account (
        id, name, partial_value, expires_at, expires_in,
        created_at, last_used_at, bcrypt_hash, team_id, hash_algorithm
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NULL, $6, $7, $8)
    `,
    [id, name, partialValue, expiresAt, expiresIn, hash, teamId, 'sha256']
  );

  console.log(`Created test service account: ${id} (team: ${teamId})`);
  console.log(`Token: ${rawToken.substring(0, 20)}...`);

  return {
    id,
    name,
    token: rawToken,
    partialValue,
    teamId,
  };
}
