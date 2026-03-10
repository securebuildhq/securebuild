import { getDB, withTransaction } from "../data/db";
import { getParam } from "../data/param";
import * as srs from "secure-random-string";

async function encryptCustomExternalRegistryPassword(password: string): Promise<string> {
  const secretEncoded = process.env.EXTERNAL_REGISTRY_ENCRYPTION_SECRET;
  if (!secretEncoded) {
    throw new Error("EXTERNAL_REGISTRY_ENCRYPTION_SECRET environment variable is required");
  }

  const secret = Buffer.from(secretEncoded, 'base64').toString('utf-8');

  // Generate a random IV for each encryption
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Create a 32-byte key from the secret using SHA-256
  const keyBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));

  // Import the key for AES-GCM
  const key = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  // Encrypt the password
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    new TextEncoder().encode(password)
  );

  // Combine IV and encrypted data, then base64 encode
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return Buffer.from(combined).toString('base64');
}


export interface CustomExternalRegistry {
  id: string;
  team_id: string;
  host: string;
  username: string;
  password: string;
}

export interface CustomExternalRegistryResponse {
  success: boolean;
  registry_id?: string;
  error?: string;
}

/**
 * Creates a custom external registry for a team
 */
export async function createCustomExternalRegistry(
  teamId: string,
  host: string,
  username: string,
  password: string
): Promise<CustomExternalRegistryResponse> {
  try {
    const db = getDB(await getParam("DB_URI"));

    let registryId: string = '';

    await withTransaction(db, async (client) => {
      // Check for duplicate host for this team
      const duplicateQuery = `
        SELECT id FROM custom_image_external_registry 
        WHERE team_id = $1 AND host = $2
      `;
      const duplicateResult = await client.query(duplicateQuery, [teamId, host]);
      
      if (duplicateResult.rows.length > 0) {
        throw new Error('Registry host already exists for this team');
      }

      // Create external registry record
      registryId = 'cer' + srs.default({ length: 32, alphanumeric: true });
      
      // Encrypt the password before storing
      const encryptedPassword = await encryptCustomExternalRegistryPassword(password);
      
      const registryQuery = `
        INSERT INTO custom_image_external_registry (id, team_id, host, username, password) 
        VALUES ($1, $2, $3, $4, $5)
      `;
      await client.query(registryQuery, [
        registryId,
        teamId,
        host,
        username,
        encryptedPassword
      ]);
    });

    return {
      success: true,
      registry_id: registryId
    };

  } catch (error) {
    console.error('Error creating custom external registry:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Gets custom external registries for a team
 */
export async function getCustomExternalRegistries(
  teamId: string
): Promise<CustomExternalRegistry[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Get all registries for the team
    const query = `
      SELECT id, team_id, host, username, password
      FROM custom_image_external_registry
      WHERE team_id = $1
      ORDER BY host
    `;

    const result = await db.query(query, [teamId]);
    
    return result.rows.map(row => ({
      id: row.id,
      team_id: row.team_id,
      host: row.host,
      username: row.username,
      password: "" // Don't return encrypted passwords to client
    }));

  } catch (error) {
    console.error('Error getting custom external registries:', error);
    throw error;
  }
}

/**
 * Deletes a custom external registry (with team access control)
 */
export async function deleteCustomExternalRegistry(
  registryId: string,
  teamId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDB(await getParam("DB_URI"));

    let deletedCount = 0;

    await withTransaction(db, async (client) => {
      // Delete with direct team access control
      const deleteQuery = `
        DELETE FROM custom_image_external_registry 
        WHERE id = $1 AND team_id = $2
      `;
      const result = await client.query(deleteQuery, [registryId, teamId]);
      deletedCount = result.rowCount || 0;
    });

    if (deletedCount === 0) {
      return {
        success: false,
        error: 'Registry not found'
      };
    }

    return {
      success: true
    };

  } catch (error) {
    console.error('Error deleting custom external registry:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}