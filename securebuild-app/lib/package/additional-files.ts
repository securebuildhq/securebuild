import { AdditionalFile } from "@/lib/types/package";
import { Session } from "@/lib/types/session";
import { getParam } from "../data/param";
import { getDB } from "../data/db";
import { enqueueWork } from "../utils/queue";
import * as srs from "secure-random-string";

export async function listAdditionalFiles(packageId: string, version: string, apkRelease: number): Promise<AdditionalFile[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT
        paf.id,
        paf.path,
        paf.content,
        paf.created_at,
        paf.updated_at
      FROM package_version_additional_file paf
      JOIN package_version pv ON paf.package_version_id = pv.id
      WHERE pv.package_id = $1
        AND pv.version = $2
        AND pv.apk_release = $3
      ORDER BY paf.path;
    `;

    const result = await db.query(query, [packageId, version, apkRelease]);

    return result.rows.map((row: any) => ({
      id: row.id,
      path: row.path,
      content: row.content,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function createAdditionalFile(
  packageId: string,
  version: string,
  apkRelease: number,
  path: string,
  content: string
): Promise<AdditionalFile> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const versionQuery = `
    SELECT id FROM package_version
    WHERE package_id = $1 AND version = $2 AND apk_release = $3
  `;
    const versionResult = await db.query(versionQuery, [packageId, version, apkRelease]);

    if (versionResult.rows.length === 0) {
      throw new Error("Package version not found");
    }

    const packageVersionId = versionResult.rows[0].id;
    const id = srs.default({ length: 24, alphanumeric: true });
    const now = new Date();

    const insertQuery = `
      INSERT INTO package_version_additional_file
      (id, package_version_id, path, content, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;

    const result = await db.query(insertQuery, [
      id,
      packageVersionId,
      path,
      content,
      now,
      now
    ]);

    const additionalFile = {
      id: result.rows[0].id,
      path: result.rows[0].path,
      content: result.rows[0].content,
      createdAt: new Date(result.rows[0].created_at),
      updatedAt: new Date(result.rows[0].updated_at),
    };

    // Enqueue github sync job after successfully creating additional file
    try {
      await enqueueWork('github_sync', {});
    } catch (syncError) {
      console.error('Failed to enqueue github sync after creating additional file:', syncError);
      // Don't fail the operation if sync enqueuing fails
    }

    return additionalFile;
  } catch (error) {
    console.error(error);
    throw error;
  }

}

export async function updateAdditionalFile(
  packageId: string,
  version: string,
  apkRelease: number,
  path: string,
  content: string
): Promise<AdditionalFile> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const versionQuery = `
      SELECT id FROM package_version
      WHERE package_id = $1 AND version = $2 AND apk_release = $3
    `;
    const versionResult = await db.query(versionQuery, [packageId, version, apkRelease]);

    if (versionResult.rows.length === 0) {
      throw new Error("Package version not found");
    }

    const packageVersionId = versionResult.rows[0].id;
    const now = new Date();

    const updateQuery = `
      UPDATE package_version_additional_file
      SET content = $1, updated_at = $2
      WHERE package_version_id = $3 AND path = $4
      RETURNING *;
    `;

    const result = await db.query(updateQuery, [
      content,
      now,
      packageVersionId,
      path
    ]);

    if (result.rows.length === 0) {
      throw new Error("Additional file not found");
    }

    const additionalFile = {
      id: result.rows[0].id,
      path: result.rows[0].path,
      content: result.rows[0].content,
      createdAt: new Date(result.rows[0].created_at),
      updatedAt: new Date(result.rows[0].updated_at),
    };

    // Enqueue github sync job after successfully updating additional file
    try {
      await enqueueWork('github_sync', {});
    } catch (syncError) {
      console.error('Failed to enqueue github sync after updating additional file:', syncError);
      // Don't fail the operation if sync enqueuing fails
    }

    return additionalFile;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function deleteAdditionalFile(
  packageId: string,
  version: string,
  apkRelease: number,
  path: string
): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const versionQuery = `
      SELECT id FROM package_version
      WHERE package_id = $1 AND version = $2 AND apk_release = $3
    `;
    const versionResult = await db.query(versionQuery, [packageId, version, apkRelease]);

    if (versionResult.rows.length === 0) {
      throw new Error("Package version not found");
    }

    const packageVersionId = versionResult.rows[0].id;

    const deleteQuery = `
      DELETE FROM package_version_additional_file
      WHERE package_version_id = $1 AND path = $2;
    `;

    await db.query(deleteQuery, [packageVersionId, path]);

    // Enqueue github sync job after successfully deleting additional file
    try {
      await enqueueWork('github_sync', {});
    } catch (syncError) {
      console.error('Failed to enqueue github sync after deleting additional file:', syncError);
      // Don't fail the operation if sync enqueuing fails
    }
  } catch (error) {
    console.error(error);
    throw error;
  }

}

export async function renameAdditionalFile(
  packageId: string,
  version: string,
  apkRelease: number,
  oldPath: string,
  newPath: string
): Promise<AdditionalFile> {

  try {
    const db = getDB(await getParam("DB_URI"));
    const versionQuery = `
      SELECT id FROM package_version
      WHERE package_id = $1 AND version = $2 AND apk_release = $3
    `;
    const versionResult = await db.query(versionQuery, [packageId, version, apkRelease]);

    if (versionResult.rows.length === 0) {
      throw new Error("Package version not found");
    }

    const packageVersionId = versionResult.rows[0].id;
    const now = new Date();

    const updateQuery = `
      UPDATE package_version_additional_file
      SET path = $1, updated_at = $2
      WHERE package_version_id = $3 AND path = $4
      RETURNING *;
    `;

    const result = await db.query(updateQuery, [
      newPath,
      now,
      packageVersionId,
      oldPath
    ]);

    if (result.rows.length === 0) {
      throw new Error("Additional file not found");
    }

    const additionalFile = {
      id: result.rows[0].id,
      path: result.rows[0].path,
      content: result.rows[0].content,
      createdAt: new Date(result.rows[0].created_at),
      updatedAt: new Date(result.rows[0].updated_at),
    };

    // Enqueue github sync job after successfully renaming additional file
    try {
      await enqueueWork('github_sync', {});
    } catch (syncError) {
      console.error('Failed to enqueue github sync after renaming additional file:', syncError);
      // Don't fail the operation if sync enqueuing fails
    }

    return additionalFile;
  } catch (error) {
    console.error(error);
    throw error;
  }

}
