import srs from "secure-random-string";
import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { ServiceAccount, ServiceAccountWithValue } from "../types/service-account";
import { traceFunction, getActiveSpan } from "../observability/tracing";
import {
  generateServiceAccountToken,
  hashTokenSHA256,
  verifyTokenBcrypt,
  serviceAccountGetPartialValue,
  ALGORITHM_SHA256,
  ALGORITHM_BCRYPT,
} from "./token";

// ErrServiceAccountNotFound is returned when a service account is not found
export class ServiceAccountNotFoundError extends Error {
  constructor(message: string = "service account not found") {
    super(message);
    this.name = "ServiceAccountNotFoundError";
  }
}

export async function createServiceAccount(teamId: string, name: string, expiresIn: string): Promise<ServiceAccountWithValue> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Generate new token with SHA-256
    const { token, hash, partialValue } = generateServiceAccountToken();

    const id = srs({ length: 12, alphanumeric: true });
    const expiresAt = expiresIn === 'never' ? null : new Date(Date.now() + parseInt(expiresIn) * 24 * 60 * 60 * 1000);
    const createdAt = new Date();

    const result = await db.query(
      `
        INSERT INTO service_account (id, name, partial_value, expires_at, expires_in, last_used_at, created_at, team_id, bcrypt_hash, hash_algorithm)
        VALUES ($1, $2, $3, $4, $5, null, $6, $7, $8, $9)
        RETURNING id, name, partial_value, expires_at, expires_in, last_used_at, created_at
      `,
      [id, name, partialValue, expiresAt, expiresIn, createdAt, teamId, hash, ALGORITHM_SHA256]
    );

    return {
      id: result.rows[0].id,
      name: result.rows[0].name,
      partialValue: result.rows[0].partial_value,
      expiresAt: result.rows[0].expires_at,
      expiresIn: result.rows[0].expires_in,
      lastUsedAt: result.rows[0].last_used_at,
      createdAt: result.rows[0].created_at,
      value: token,
    };
  } catch (err) {
    console.error("Error creating service account:", err);
    throw err;
  }
}

export async function rotateServiceAccount(serviceAccount: ServiceAccount): Promise<ServiceAccountWithValue> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Generate new token with SHA-256
    const { token, hash, partialValue } = generateServiceAccountToken();

    const expiresIn = serviceAccount.expiresIn;
    const expiresAt = expiresIn === 'never' ? null : new Date(Date.now() + parseInt(expiresIn!) * 24 * 60 * 60 * 1000);

    await db.query(
      `update service_account set partial_value = $1, bcrypt_hash = $2, expires_at = $3, hash_algorithm = $4 where id = $5`,
      [partialValue, hash, expiresAt, ALGORITHM_SHA256, serviceAccount.id]
    );

    return {
      id: serviceAccount.id,
      name: serviceAccount.name,
      partialValue: partialValue,
      expiresAt: expiresAt,
      expiresIn: expiresIn,
      lastUsedAt: serviceAccount.lastUsedAt,
      createdAt: serviceAccount.createdAt,
      value: token,
    };
  } catch (err) {
    console.error("Error rotating service account:", err);
    throw err;
  }
}

export async function deleteServiceAccount(serviceAccount: ServiceAccount): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await db.query(`delete from service_account where id = $1`, [serviceAccount.id]);
  } catch (err) {
    console.error("Error deleting service account:", err);
    throw err;
  }
}

export async function listServiceAccounts(teamId: string): Promise<ServiceAccount[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id, name, partial_value, expires_at, expires_in, last_used_at, created_at from service_account where team_id = $1`
    const result = await db.query(query, [teamId]);

    const serviceAccounts = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      partialValue: row.partial_value,
      expiresAt: row.expires_at,
      expiresIn: row.expires_in,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
    }));

    return serviceAccounts;
  } catch (err) {
    console.error("Error listing service accounts:", err);
    throw err;
  }
}

export async function renameServiceAccount(serviceAccountId: string, newName: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await db.query(`update service_account set name = $1 where id = $2`, [newName, serviceAccountId]);
  } catch (err) {
    console.error("Error renaming service account:", err);
    throw err;
  }
}

/**
 * UpdateServiceAccountLastActive updates the last used timestamp for a service account
 *
 * It returns an error if the update fails.
 */
async function updateServiceAccountLastActive(serviceAccountID: string): Promise<void> {
  const db = getDB(await getParam("DB_URI"));
  const query = `update service_account set last_used_at = now() where id = $1`;
  await db.query(query, [serviceAccountID]);
}

/**
 * findServiceAccountWithValueSHA256 looks up a service account using SHA-256 hash lookup
 *
 * This is the fast path for new tokens.
 */
async function findServiceAccountWithValueSHA256(
  teamId: string | undefined,
  plainTextValue: string
): Promise<{ serviceAccount: ServiceAccount; teamId: string }> {
  const db = getDB(await getParam("DB_URI"));

  // Fast path: Try SHA-256 lookup first (for new tokens)
  const sha256Hash = hashTokenSHA256(plainTextValue);

  let sha256Query: string;
  let queryParams: any[];

  if (teamId) {
    sha256Query = `
      SELECT id, name, expires_at, hash_algorithm, expires_in, last_used_at, created_at, team_id, partial_value
      FROM service_account
      WHERE team_id = $1
        AND bcrypt_hash = $2
        AND hash_algorithm = $3
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
    queryParams = [teamId, sha256Hash, ALGORITHM_SHA256];
  } else {
    sha256Query = `
      SELECT id, name, expires_at, hash_algorithm, expires_in, last_used_at, created_at, team_id, partial_value
      FROM service_account
      WHERE bcrypt_hash = $1
        AND hash_algorithm = $2
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
    queryParams = [sha256Hash, ALGORITHM_SHA256];
  }

  const result = await db.query(sha256Query, queryParams);

  if (result.rows.length === 0) {
    throw new ServiceAccountNotFoundError();
  }

  const row = result.rows[0];

  return {
    serviceAccount: {
      id: row.id,
      name: row.name,
      partialValue: row.partial_value,
      expiresAt: row.expires_at,
      expiresIn: row.expires_in,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
    },
    teamId: row.team_id,
  };
}

/**
 * findServiceAccountWithValueBcrypt looks up a service account using bcrypt comparison
 *
 * This is the slow path for legacy tokens. If a match is found, it automatically
 * migrates the token to SHA-256.
 */
async function findServiceAccountWithValueBcrypt(
  teamId: string | undefined,
  plainTextValue: string
): Promise<{ serviceAccount: ServiceAccount; teamId: string }> {
  const db = getDB(await getParam("DB_URI"));

  // Slow path: Fall back to bcrypt for legacy tokens
  // Use partial_value filter to reduce bcrypt comparisons
  const partialValue = serviceAccountGetPartialValue(plainTextValue);

  let query: string;
  let queryParams: any[];

  if (teamId) {
    query = `
      SELECT id, name, expires_at, bcrypt_hash, expires_in, last_used_at, created_at, team_id, partial_value
      FROM service_account
      WHERE team_id = $1
        AND hash_algorithm = $2
        AND partial_value = $3
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
    queryParams = [teamId, ALGORITHM_BCRYPT, partialValue];
  } else {
    query = `
      SELECT id, name, expires_at, bcrypt_hash, expires_in, last_used_at, created_at, team_id, partial_value
      FROM service_account
      WHERE hash_algorithm = $1
        AND partial_value = $2
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
    queryParams = [ALGORITHM_BCRYPT, partialValue];
  }

  const result = await db.query(query, queryParams);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serviceAccounts: Map<string, { row: any }> = new Map();

  for (const row of result.rows) {
    serviceAccounts.set(row.bcrypt_hash, { row });
  }

  for (const [hash, { row }] of serviceAccounts) {
    const isMatch = await verifyTokenBcrypt(plainTextValue, hash);
    if (isMatch) {
      const fields = {
        serviceAccountID: row.id,
        teamId,
      };

      console.log("found service account with bcrypt", fields);

      // Auto-migrate to SHA-256
      const newHash = hashTokenSHA256(plainTextValue);
      const migrationQuery = `
        UPDATE service_account
        SET bcrypt_hash = $1, hash_algorithm = $2
        WHERE id = $3
      `;

      try {
        await db.query(migrationQuery, [newHash, ALGORITHM_SHA256, row.id]);
        console.log("migrated service account token from bcrypt to SHA-256", fields);
      } catch (err) {
        console.error("failed to migrate token to SHA-256 for service account", fields, err);
        // Don't fail authentication if migration fails
      }

      return {
        serviceAccount: {
          id: row.id,
          name: row.name,
          partialValue: row.partial_value,
          expiresAt: row.expires_at,
          expiresIn: row.expires_in,
          lastUsedAt: row.last_used_at,
          createdAt: row.created_at,
        },
        teamId: row.team_id,
      };
    }
  }

  throw new ServiceAccountNotFoundError();
}

/**
 * FindServiceAccountWithValue looks up a service account by its plain text value,
 * first trying SHA-256 and then bcrypt
 *
 * If the service account is found, it returns the service account and teamId.
 * If the service account is not found, it returns null.
 * If the service account is found with bcrypt, it will automatically migrate it to SHA-256.
 *
 * @param teamIdOrPlainText - Either the teamId (when both params provided) or plainTextValue (when single param)
 * @param plainTextValue - The plain text token value (optional, used when teamId is provided)
 */
export const findServiceAccountWithValue = traceFunction(
  "lib.team.findServiceAccountWithValue",
  async (
    teamIdOrPlainText: string,
    plainTextValue?: string
  ): Promise<{ serviceAccount: ServiceAccount; teamId: string } | null> => {
    // Handle both signatures: (plainTextValue) and (teamId, plainTextValue)
    let teamId: string | undefined;
    let token: string;

    if (plainTextValue === undefined) {
      // Single parameter: findServiceAccountWithValue(plainTextValue)
      teamId = undefined;
      token = teamIdOrPlainText;
    } else {
      // Two parameters: findServiceAccountWithValue(teamId, plainTextValue)
      teamId = teamIdOrPlainText;
      token = plainTextValue;
    }
    try {
      const activeSpan = getActiveSpan();

      // Try SHA-256 first (fast path)
      try {
        const result = await findServiceAccountWithValueSHA256(teamId, token);

        // Update last used timestamp
        await updateServiceAccountLastActive(result.serviceAccount.id);
        result.serviceAccount.lastUsedAt = new Date(); // Update in returned object

        activeSpan?.setTag("lookup.method", "sha256");
        return result;
      } catch (err) {
        if (!(err instanceof ServiceAccountNotFoundError)) {
          // If it's not a "not found" error, rethrow
          throw err;
        }
        // Continue to bcrypt fallback
      }

      // Try bcrypt (slow path for legacy tokens)
      try {
        const result = await findServiceAccountWithValueBcrypt(teamId, token);

        // Update last used timestamp
        await updateServiceAccountLastActive(result.serviceAccount.id);
        result.serviceAccount.lastUsedAt = new Date(); // Update in returned object

        activeSpan?.setTag("lookup.method", "bcrypt");
        return result;
      } catch (err) {
        if (!(err instanceof ServiceAccountNotFoundError)) {
          // If it's not a "not found" error, rethrow
          throw err;
        }
        // Token not found with either method
      }

      return null;
    } catch (err) {
      console.error("Error finding service account with value:", err);
      throw err;
    }
  }
);
