import { getDB } from "../data/db";
import { getParam } from "../data/param";
import * as srs from "secure-random-string";

export interface ImageTestData {
  yamlContent: string;
  description: string | null;
}

/**
 * Get the test YAML for a specific APKO version
 */
export async function getImageTest(
  apkoId: string,
  apkoVersionId: string
): Promise<string | null> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(
      `SELECT yaml_content
       FROM image_test
       WHERE apko_id = $1 AND apko_version_id = $2`,
      [apkoId, apkoVersionId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].yaml_content;
  } catch (error) {
    throw new Error(`Failed to get image test for APKO ${apkoId}, version ${apkoVersionId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Create or update a test YAML for a specific APKO version
 */
export async function createOrUpdateImageTest(
  apkoId: string,
  apkoVersionId: string,
  testYaml: string,
  description?: string
): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Generate ID using the same pattern as other entities in the codebase
    const testId = 'it' + (srs as any).default({ length: 32, alphanumeric: true });

    // Upsert the test
    await db.query(
      `INSERT INTO image_test (id, apko_id, apko_version_id, yaml_content, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (apko_id, apko_version_id)
       DO UPDATE SET
         yaml_content = EXCLUDED.yaml_content,
         description = EXCLUDED.description,
         updated_at = NOW()`,
      [testId, apkoId, apkoVersionId, testYaml, description || null]
    );
  } catch (error) {
    throw new Error(`Failed to create or update image test for APKO ${apkoId}, version ${apkoVersionId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Delete the test YAML for a specific APKO version
 */
export async function deleteImageTest(
  apkoId: string,
  apkoVersionId: string
): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));

    await db.query(
      `DELETE FROM image_test
       WHERE apko_id = $1 AND apko_version_id = $2`,
      [apkoId, apkoVersionId]
    );
  } catch (error) {
    throw new Error(`Failed to delete image test for APKO ${apkoId}, version ${apkoVersionId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get test data for the latest version of an APKO
 * This is used when loading APKO data in the image page and when copying tests to new versions
 */
export async function getImageTestForLatestVersion(
  apkoId: string
): Promise<ImageTestData | null> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(
      `SELECT it.yaml_content, it.description
       FROM image_test it
       JOIN image_apko_version iav ON it.apko_version_id = iav.id
       WHERE it.apko_id = $1
       ORDER BY iav.created_at DESC
       LIMIT 1`,
      [apkoId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      yamlContent: result.rows[0].yaml_content,
      description: result.rows[0].description,
    };
  } catch (error) {
    throw new Error(`Failed to get image test for latest version of APKO ${apkoId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
