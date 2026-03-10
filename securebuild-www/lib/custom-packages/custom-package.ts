import { getDB, withTransaction } from "../data/db";
import { getParam } from "../data/param";
import { CustomPackage, CustomPackageVersion, CustomPackageVersionAdditionalFile } from "../types/custom-package";
import srs from "secure-random-string";

/**
 * Create a new custom package record
 */
export async function createCustomPackage(
  name: string,
  teamId: string,
  parentId?: string
): Promise<string> {
  const db = getDB(await getParam("DB_URI"));
  
  const customPackageId = 'cp' + srs({ length: 32, alphanumeric: true });
  
  const query = `
    INSERT INTO custom_package (id, parent_id, name, team_id, created_at, updated_at, is_delete_protection_enabled) 
    VALUES ($1, $2, $3, $4, now(), now(), $5)
  `;
  
  try {
    await db.query(query, [customPackageId, parentId || null, name, teamId, false]);
    return customPackageId;
  } catch (error: unknown) {
    // Handle unique constraint violations
    if ((error as { code?: string }).code === '23505') {
      throw new Error(`Package ${name} already exists`);
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Create a new custom package version record
 */
export async function createCustomPackageVersion(
  customPackageId: string,
  version: string,
  melangeYaml?: string,
  license?: string,
  useRoot: boolean = false,
  apkRelease: number = 0
): Promise<string> {
  const db = getDB(await getParam("DB_URI"));
  
  const customPackageVersionId = 'cpv' + srs({ length: 32, alphanumeric: true });
  
  const query = `
    INSERT INTO custom_package_version (id, custom_package_id, version, melange_yaml, license, apk_release, use_root, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
  `;

  await db.query(query, [
    customPackageVersionId,
    customPackageId,
    version,
    melangeYaml || null,
    license || null,
    apkRelease,
    useRoot
  ]);
  
  return customPackageVersionId;
}

/**
 * Create additional file for a custom package version
 */
export async function createCustomPackageAdditionalFile(
  customPackageVersionId: string,
  path: string,
  content: string
): Promise<string> {
  const db = getDB(await getParam("DB_URI"));
  
  const additionalFileId = 'cpaf' + srs({ length: 32, alphanumeric: true });
  
  const query = `
    INSERT INTO custom_package_version_additional_file (id, custom_package_version_id, path, content, created_at, updated_at) 
    VALUES ($1, $2, $3, $4, now(), now())
  `;
  
  await db.query(query, [additionalFileId, customPackageVersionId, path, content]);
  
  return additionalFileId;
}

/**
 * Get a custom package by ID and team
 */
export async function getCustomPackage(customPackageId: string, teamId: string): Promise<CustomPackage | null> {
  const db = getDB(await getParam("DB_URI"));
  
  const query = `
    SELECT id, parent_id, name, team_id, created_at, updated_at, check_for_updates_at, is_delete_protection_enabled
    FROM custom_package
    WHERE id = $1 AND team_id = $2
  `;
  
  const result = await db.query(query, [customPackageId, teamId]);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const row = result.rows[0];
  return {
    id: row.id,
    parent_id: row.parent_id,
    name: row.name,
    team_id: row.team_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    check_for_updates_at: row.check_for_updates_at,
    is_delete_protection_enabled: row.is_delete_protection_enabled
  };
}

/**
 * Get all custom packages for a team
 */
export async function getCustomPackages(teamId: string): Promise<CustomPackage[]> {
  const db = getDB(await getParam("DB_URI"));
  
  const query = `
    SELECT id, parent_id, name, team_id, created_at, updated_at, check_for_updates_at, is_delete_protection_enabled
    FROM custom_package
    WHERE team_id = $1 AND parent_id IS NULL
    ORDER BY name ASC
  `;
  
  const result = await db.query(query, [teamId]);
  
  return result.rows.map(row => ({
    id: row.id,
    parent_id: row.parent_id,
    name: row.name,
    team_id: row.team_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    check_for_updates_at: row.check_for_updates_at,
    is_delete_protection_enabled: row.is_delete_protection_enabled
  }));
}

/**
 * Get custom package versions for a package
 */
export async function getCustomPackageVersions(customPackageId: string, teamId: string): Promise<CustomPackageVersion[]> {
  const db = getDB(await getParam("DB_URI"));
  
  // First verify the package belongs to the team
  const packageCheck = await getCustomPackage(customPackageId, teamId);
  if (!packageCheck) {
    return [];
  }
  
  const query = `
    SELECT id, custom_package_id, version, melange_yaml, created_at, updated_at, license, apk_release, use_root
    FROM custom_package_version
    WHERE custom_package_id = $1
    ORDER BY created_at DESC
  `;
  
  const result = await db.query(query, [customPackageId]);
  
  return result.rows.map(row => ({
    id: row.id,
    custom_package_id: row.custom_package_id,
    version: row.version,
    melange_yaml: row.melange_yaml,
    created_at: row.created_at,
    updated_at: row.updated_at,
    license: row.license,
    apk_release: row.apk_release,
    use_root: row.use_root
  }));
}

/**
 * Get additional files for a custom package version
 */
export async function getCustomPackageAdditionalFiles(customPackageVersionId: string): Promise<CustomPackageVersionAdditionalFile[]> {
  const db = getDB(await getParam("DB_URI"));
  
  const query = `
    SELECT id, custom_package_version_id, path, content, created_at, updated_at
    FROM custom_package_version_additional_file
    WHERE custom_package_version_id = $1
    ORDER BY path ASC
  `;
  
  const result = await db.query(query, [customPackageVersionId]);
  
  return result.rows.map(row => ({
    id: row.id,
    custom_package_version_id: row.custom_package_version_id,
    path: row.path,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

/**
 * Delete a custom package and all its versions (admin only)
 */
export async function deleteCustomPackage(customPackageId: string, teamId: string): Promise<boolean> {
  const db = getDB(await getParam("DB_URI"));
  
  return await withTransaction(db, async (client) => {
    // Delete additional files for all versions
    await client.query(`
      DELETE FROM custom_package_version_additional_file 
      WHERE custom_package_version_id IN (
        SELECT id FROM custom_package_version WHERE custom_package_id = $1
      )
    `, [customPackageId]);
    
    // Delete package versions
    await client.query(`
      DELETE FROM custom_package_version WHERE custom_package_id = $1
    `, [customPackageId]);
    
    // Delete the package itself (only if belongs to the team)
    const result = await client.query(`
      DELETE FROM custom_package WHERE id = $1 AND team_id = $2
    `, [customPackageId, teamId]);
    
    return (result.rowCount || 0) > 0;
  });
}

export interface CustomPackageListOptions {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  teamId?: string;
  sortField?: 'name' | 'created_at' | 'team' | 'status' | 'version';
  sortDirection?: 'ASC' | 'DESC';
}

export interface CustomPackageListResult {
  packages: Array<CustomPackage & { team_name?: string; version?: string }>;
  totalCount: number;
}

/**
 * Get custom packages with team information for dashboard display
 */
export async function getCustomPackagesWithTeamInfo(options: CustomPackageListOptions): Promise<CustomPackageListResult> {
  const db = getDB(await getParam("DB_URI"));
  
  let whereClause = 'WHERE cp.parent_id IS NULL';
  const queryParams: unknown[] = [];
  let paramIndex = 1;

  // Add search filter
  if (options.search) {
    whereClause += ` AND (cp.name ILIKE $${paramIndex} OR t.name ILIKE $${paramIndex})`;
    queryParams.push(`%${options.search}%`);
    paramIndex++;
  }

  // Add team filter
  if (options.teamId) {
    whereClause += ` AND cp.team_id = $${paramIndex}`;
    queryParams.push(options.teamId);
    paramIndex++;
  }

  // Add status filter (we'll need to join with builds or package versions for this)
  // For now, we'll skip status filtering until we have build status integration

  // Add sorting
  let orderBy = 'ORDER BY cp.created_at DESC';
  if (options.sortField) {
    const direction = options.sortDirection || 'ASC';
    switch (options.sortField) {
      case 'name':
        orderBy = `ORDER BY cp.name ${direction}`;
        break;
      case 'team':
        orderBy = `ORDER BY COALESCE(t.name, cp.team_id) ${direction}`;
        break;
      case 'created_at':
        orderBy = `ORDER BY cp.created_at ${direction}`;
        break;
      case 'version':
        orderBy = `ORDER BY cpv.version ${direction}`;
        break;
      default:
        orderBy = `ORDER BY cp.created_at ${direction}`;
    }
  }

  // Get total count
  const countQuery = `
    SELECT COUNT(DISTINCT cp.id) as total
    FROM custom_package cp
    LEFT JOIN team t ON cp.team_id = t.id
    ${whereClause}
  `;
  
  const countResult = await db.query(countQuery, queryParams);
  const totalCount = parseInt(countResult.rows[0]?.total || '0');

  // Get paginated results with team info
  const offset = (options.page - 1) * options.limit;
  const packagesQuery = `
    SELECT 
      cp.*,
      t.name as team_name,
      cpv.version,
      cpv.created_at as version_created_at
    FROM custom_package cp
    LEFT JOIN team t ON cp.team_id = t.id
    LEFT JOIN LATERAL (
      SELECT version, created_at
      FROM custom_package_version 
      WHERE custom_package_id = cp.id 
      ORDER BY created_at DESC 
      LIMIT 1
    ) cpv ON true
    ${whereClause}
    ${orderBy}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  queryParams.push(options.limit, offset);
  const packagesResult = await db.query(packagesQuery, queryParams);

  const packages = packagesResult.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    parent_id: row.parent_id as string | undefined,
    name: row.name as string,
    team_id: row.team_id as string,
    team_name: row.team_name as string | undefined,
    created_at: row.created_at as Date,
    updated_at: row.updated_at as Date | undefined,
    check_for_updates_at: row.check_for_updates_at as Date | undefined,
    is_delete_protection_enabled: row.is_delete_protection_enabled as boolean,
    version: row.version as string | undefined,
    // We'll add build status integration later
    last_build_status: undefined,
    last_build_at: undefined,
  }));

  return {
    packages,
    totalCount
  };
}

export interface CustomPackageExecution {
  id: string;
  packageName: string;
  status: string;
  createdAt: string;
  versionLabel: string;
  aarch64_build_stderr?: string;
  x86_64_build_stderr?: string;
}

/**
 * Get build executions for a custom package
 */
export async function getCustomPackageExecutions(customPackageId: string, teamId: string): Promise<CustomPackageExecution[]> {
  const db = getDB(await getParam("DB_URI"));
  
  // First verify the package belongs to the team
  const packageCheck = await getCustomPackage(customPackageId, teamId);
  if (!packageCheck) {
    return [];
  }
  
  // Query executions that have is_custom_package = true and match the package
  // Note: This assumes the execution table has been updated to track custom packages
  const query = `
    SELECT 
      e.id,
      cp.name as "packageName",
      e.status,
      e.created_at as "createdAt",
      e.version_label as "versionLabel",
      e.aarch64_build_stderr,
      e.x86_64_build_stderr
    FROM execution e
    JOIN custom_package cp ON e.package_id = cp.id
    WHERE e.is_custom_package = true 
    AND e.package_id = $1
    ORDER BY e.created_at DESC
    LIMIT 50
  `;
  
  try {
    const result = await db.query(query, [customPackageId]);
    
    return result.rows.map(row => ({
      id: row.id,
      packageName: row.packageName,
      status: row.status,
      createdAt: row.createdAt,
      versionLabel: row.versionLabel || 'unknown',
      aarch64_build_stderr: row.aarch64_build_stderr,
      x86_64_build_stderr: row.x86_64_build_stderr
    }));
  } catch (error) {
    console.error('Error fetching custom package executions:', error);
    return [];
  }
}
