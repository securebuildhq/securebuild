import { getDB } from "../data/db";
import { getParam } from "../data/param";
import * as srs from "secure-random-string";

/**
 * Check if a team has permission to build a specific image
 */
export async function checkTeamCustomBuildImagePermission(
  teamId: string,
  imageName: string
): Promise<boolean> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    SELECT id
    FROM team_custom_build_image
    WHERE team_id = $1 AND image_name = $2
  `;

  const result = await db.query(query, [teamId, imageName]);
  return result.rows.length > 0;
}

/**
 * Get all custom build images for a team
 */
export async function getTeamCustomBuildImages(teamId: string): Promise<string[]> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    SELECT image_name
    FROM team_custom_build_image
    WHERE team_id = $1
    ORDER BY image_name ASC
  `;

  const result = await db.query(query, [teamId]);
  return result.rows.map(row => row.image_name);
}

/**
 * Add custom build image permission for a team
 */
export async function addTeamCustomBuildImage(
  teamId: string,
  imageName: string
): Promise<void> {
  const db = getDB(await getParam("DB_URI"));
  const id = 'tcbi_' + srs.default({ length: 32, alphanumeric: true });

  const query = `
    INSERT INTO team_custom_build_image
    (id, team_id, image_name, created_at, updated_at)
    VALUES ($1, $2, $3, now(), now())
    ON CONFLICT (team_id, image_name) DO NOTHING
  `;

  await db.query(query, [id, teamId, imageName]);
}

/**
 * Remove custom build image permission for a team
 */
export async function removeTeamCustomBuildImage(
  teamId: string,
  imageName: string
): Promise<void> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    DELETE FROM team_custom_build_image
    WHERE team_id = $1 AND image_name = $2
  `;

  await db.query(query, [teamId, imageName]);
}

/**
 * Custom build request status values
 */
export const CustomBuildRequestStatus = {
  PENDING: 'pending',      // Builds not yet queued
  EMPTY: '',               // Builds queued, aggregate status from builds
  FAILED: 'failed',        // Pre-build error occurred
} as const;

export type CustomBuildRequestStatusType = typeof CustomBuildRequestStatus[keyof typeof CustomBuildRequestStatus];

/**
 * Custom build request interface
 */
export interface CustomBuildRequest {
  id: string;
  teamId: string;
  imageName: string;
  imageTag: string;
  commitSha: string;
  status: CustomBuildRequestStatusType;
  error: string | null;
  createdAt: Date;
}

/**
 * Create a new custom build request
 */
export async function createCustomBuildRequest(
  teamId: string,
  imageName: string,
  imageTag: string,
  commitSha: string
): Promise<string> {
  const db = getDB(await getParam("DB_URI"));
  const id = 'cbr_' + srs.default({ length: 32, alphanumeric: true });

  const query = `
    INSERT INTO custom_build_request
    (id, team_id, image_name, image_tag, commit_sha, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, now())
  `;

  await db.query(query, [
    id,
    teamId,
    imageName,
    imageTag,
    commitSha,
    CustomBuildRequestStatus.PENDING
  ]);

  return id;
}

/**
 * Get a custom build request by ID with team validation
 */
export async function getCustomBuildRequest(
  buildRequestId: string,
  teamId: string
): Promise<CustomBuildRequest | null> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    SELECT id, team_id, image_name, image_tag, commit_sha, status, error, created_at
    FROM custom_build_request
    WHERE id = $1 AND team_id = $2
  `;

  const result = await db.query(query, [buildRequestId, teamId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    teamId: row.team_id,
    imageName: row.image_name,
    imageTag: row.image_tag,
    commitSha: row.commit_sha,
    status: row.status,
    error: row.error,
    createdAt: row.created_at
  };
}

/**
 * Update custom build request status
 */
export async function updateCustomBuildRequestStatus(
  buildRequestId: string,
  status: CustomBuildRequestStatusType
): Promise<void> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    UPDATE custom_build_request
    SET status = $1
    WHERE id = $2
  `;

  await db.query(query, [status, buildRequestId]);
}

/**
 * Update custom build request with error
 */
export async function updateCustomBuildRequestError(
  buildRequestId: string,
  status: CustomBuildRequestStatusType,
  error: string
): Promise<void> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    UPDATE custom_build_request
    SET status = $1, error = $2
    WHERE id = $3
  `;

  await db.query(query, [status, error, buildRequestId]);
}

/**
 * Get package versions for a custom build request
 */
export async function getPackageVersionsByCustomBuildRequestId(
  buildRequestId: string
): Promise<Array<{ id: string; packageId: string; version: string; apkRelease: number }>> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    SELECT id, package_id, version, apk_release
    FROM package_version
    WHERE custom_build_request_id = $1
    ORDER BY created_at ASC
  `;

  const result = await db.query(query, [buildRequestId]);

  return result.rows.map(row => ({
    id: row.id,
    packageId: row.package_id,
    version: row.version,
    apkRelease: row.apk_release
  }));
}

/**
 * Get image APKO versions for a custom build request
 */
export async function getImageAPKOVersionsByCustomBuildRequestId(
  buildRequestId: string
): Promise<Array<{ id: string; imageApkoId: string; apkoYaml: string }>> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    SELECT id, image_apko_id, apko_yaml
    FROM image_apko_version
    WHERE custom_build_request_id = $1
    ORDER BY created_at ASC
  `;

  const result = await db.query(query, [buildRequestId]);

  return result.rows.map(row => ({
    id: row.id,
    imageApkoId: row.image_apko_id,
    apkoYaml: row.apko_yaml
  }));
}

/**
 * Get executions for a package version
 */
export async function getExecutionsByPackageVersionId(
  packageVersionId: string
): Promise<Array<{
  id: string;
  status: string;
  createdAt: Date;
  x86_64BuildStdout: string | null;
  x86_64BuildStderr: string | null;
  x86_64Status: string | null;
  aarch64BuildStdout: string | null;
  aarch64BuildStderr: string | null;
  aarch64Status: string | null;
}>> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    SELECT
      id, status, created_at,
      x86_64_build_stdout, x86_64_build_stderr, x86_64_status,
      aarch64_build_stdout, aarch64_build_stderr, aarch64_status
    FROM execution
    WHERE package_version_id = $1
    ORDER BY created_at DESC
  `;

  const result = await db.query(query, [packageVersionId]);

  return result.rows.map(row => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    x86_64BuildStdout: row.x86_64_build_stdout,
    x86_64BuildStderr: row.x86_64_build_stderr,
    x86_64Status: row.x86_64_status,
    aarch64BuildStdout: row.aarch64_build_stdout,
    aarch64BuildStderr: row.aarch64_build_stderr,
    aarch64Status: row.aarch64_status
  }));
}

/**
 * Get image builds for an APKO version
 */
export async function getImageBuildsByApkoVersionId(
  apkoVersionId: string
): Promise<Array<{
  id: string;
  status: string;
  createdAt: Date;
  apkoStdout: string | null;
  apkoStderr: string | null;
  grypeX8664Stderr: string | null;
  grypeAarch64Stderr: string | null;
  workerError: string | null;
}>> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    SELECT
      id, status, created_at,
      apko_stdout, apko_stderr,
      grype_x86_64_stderr, grype_aarch64_stderr,
      worker_error
    FROM image_build
    WHERE image_apko_version_id = $1
    ORDER BY created_at DESC
  `;

  const result = await db.query(query, [apkoVersionId]);

  return result.rows.map(row => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    apkoStdout: row.apko_stdout,
    apkoStderr: row.apko_stderr,
    grypeX8664Stderr: row.grype_x86_64_stderr,
    grypeAarch64Stderr: row.grype_aarch64_stderr,
    workerError: row.worker_error
  }));
}

/**
 * Get package info for a package version (joins package table)
 */
export async function getPackageInfoForVersion(
  packageVersionId: string
): Promise<{ packageName: string; version: string; apkRelease: number } | null> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    SELECT p.name as package_name, pv.version, pv.apk_release
    FROM package_version pv
    JOIN package p ON pv.package_id = p.id
    WHERE pv.id = $1
  `;

  const result = await db.query(query, [packageVersionId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    packageName: row.package_name,
    version: row.version,
    apkRelease: row.apk_release
  };
}

/**
 * Get image info for an APKO version (joins image_apko and image tables)
 */
export async function getImageInfoForApkoVersion(
  apkoVersionId: string
): Promise<{ imageName: string; tags: string[] } | null> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    SELECT i.name as image_name, ia.tags
    FROM image_apko_version iav
    JOIN image_apko ia ON iav.image_apko_id = ia.id
    JOIN image i ON ia.image_id = i.id
    WHERE iav.id = $1
  `;

  const result = await db.query(query, [apkoVersionId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    imageName: row.image_name,
    tags: row.tags
  };
}
