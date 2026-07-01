import { getDB, withTransaction } from "../data/db";
import { Pool, PoolClient } from "pg";
import { Package, PackageBuild, PackageVersion, Patch, VersionInfo, AdditionalFile, PackageDependency, AdditionalFiles } from "../types/package";
import { decodeAndExtractAdditionalFiles } from "./tar";
import { getParam } from "../data/param";
import * as srs from "secure-random-string";
import { enqueueWork } from "../utils/queue";
import { logger } from "../utils/logger";
import * as crypto from "crypto";
import { ValidationError } from "../errors/validation-error";
import * as yaml from "js-yaml";
import { compileMelangeYAML } from "./provides";

async function getSubpackagesFromMelangeYaml(melangeYaml: string): Promise<string[]> {
  const compiledConfig = await compileMelangeYAML(melangeYaml);

  if (!compiledConfig?.package?.name) {
    throw new ValidationError('Invalid melange configuration: missing package name');
  }

  // Get subpackages from compiled config
  return (compiledConfig.subpackages || []).map(sp => sp.name);
}

async function updateSubpackagesInDB(
  client: Pool | PoolClient,
  pkgId: string,
  newSubpackages: string[],
  currentSubpackages: Package[]
): Promise<void> {
  const currentSubpackageNames = new Set(currentSubpackages.map(sp => sp.name));

  // Find subpackages to remove/add
  const subpackagesToRemove = currentSubpackages.filter(sp => !newSubpackages.includes(sp.name));
  const subpackagesToAdd = newSubpackages.filter(name => !currentSubpackageNames.has(name));

  // Mark removed subpackages as deleted
  for (const subpackage of subpackagesToRemove) {
    await client.query(`
      update package
      set is_deleted = true, updated_at = now()
      where id = $1
    `, [subpackage.id]);
  }

  // Add new subpackages or reactivate deleted ones
  for (const subpackageName of subpackagesToAdd) {
    // Check if this subpackage name was used before
    const existingResult = await client.query(`
      select id
      from package
      where name = $1 and parent_id = $2
    `, [subpackageName, pkgId]);

    if (existingResult.rows.length > 0) {
      // Reactivate the existing subpackage
      await client.query(`
        update package
        set is_deleted = false, updated_at = now()
        where id = $1
      `, [existingResult.rows[0].id]);
    } else {
      // Create a new subpackage
      const subpackageId = crypto.randomBytes(32).toString('hex');
      await client.query(`
        insert into package (id, name, created_at, updated_at, parent_id)
        values ($1, $2, now(), now(), $3)
      `, [subpackageId, subpackageName, pkgId]);
    }
  }
}

export interface PackageFilters {
  search: string;
  type: string;
  status: string;
  source: string;
  fips: string;
  arch: string;
  sortField?: string;
  sortDirection?: string;
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

interface MelangePackageInfo {
  name?: string;
  version?: string;
}

export function extractPackageInfoFromMelange(melangeYaml: string): MelangePackageInfo {
  try {
    const doc = yaml.load(melangeYaml) as any;
    
    if (!doc || typeof doc !== 'object') {
      throw new ValidationError('Invalid YAML structure');
    }
    
    const packageInfo = doc.package;
    if (!packageInfo || typeof packageInfo !== 'object') {
      throw new ValidationError('Missing or invalid package section');
    }
    
    return {
      name: packageInfo.name,
      // Convert version to string to handle cases where YAML parser treats
      // unquoted numeric versions (like 0.193) as numbers instead of strings.
      // Note: This may lose trailing zeros (1.0 -> "1") or change scientific notation,
      // but works correctly for typical semantic versions.
      version: packageInfo.version ? String(packageInfo.version) : undefined
    };
  } catch (error) {
    if (error instanceof yaml.YAMLException) {
      throw new ValidationError(`Invalid YAML: ${error.message}`);
    }
    throw error;
  }
}

export async function updatePackageVersion(pkgVersionId: string, melangeYaml: string | undefined, useRoot: boolean, bootstrapEnabled: boolean, bootstrapApkRepository: string | null | undefined, bootstrapKeyringAppend: string | null | undefined, customDiskSize: number | null | undefined): Promise<PackageVersion> {
  try {
    const db = getDB(await getParam("DB_URI"));
    let melangeYamlUpdated = false;

    // Get the package version to get the package ID
    const currentVersion = await getPackageVersionById(pkgVersionId);
    const pkgId = currentVersion.packageId;

    // Get new subpackages from melange YAML if provided
    let newSubpackages: string[] = [];
    if (melangeYaml) {
      newSubpackages = await getSubpackagesFromMelangeYaml(melangeYaml);
    }

    // Update everything in a single transaction
    await withTransaction(db, async (client) => {
      // Get current subpackages from database
      const currentSubpackages = await listSubpackages(client, pkgId);
      if (melangeYaml) {
        // Update package version
        {
          const query = `update package_version set has_securebuild_edits = true where id = $1`;
          await client.query(query, [pkgVersionId]);
        }

        {
          const query = `update package_version set melange_yaml = $1 where id = $2`;
          await client.query(query, [melangeYaml, pkgVersionId]);
          melangeYamlUpdated = true;
        }

        // Update provides data
        const { writePackageVersionProvides } = await import('./provides');
        await writePackageVersionProvides(client, pkgVersionId, melangeYaml);

        await updateSubpackagesInDB(client, pkgId, newSubpackages, currentSubpackages);
      }

      {
        const query = `update package_version set use_root = $1 where id = $2`;
        await client.query(query, [useRoot, pkgVersionId]);
      }

      {
        const query = `update package_version set bootstrap_enabled = $1 where id = $2`;
        await client.query(query, [bootstrapEnabled, pkgVersionId]);
      }

      if (bootstrapApkRepository !== undefined) {
        const query = `update package_version set bootstrap_apk_repository = $1 where id = $2`;
        await client.query(query, [bootstrapApkRepository, pkgVersionId]);
      }

      if (bootstrapKeyringAppend !== undefined) {
        const query = `update package_version set bootstrap_keyring_append = $1 where id = $2`;
        await client.query(query, [bootstrapKeyringAppend, pkgVersionId]);
      }

      if (customDiskSize !== undefined) {
        const query = `update package_version set custom_disk_size = $1 where id = $2`;
        await client.query(query, [customDiskSize, pkgVersionId]);
      }
    });

    // Trigger GitHub sync after melange YAML update
    if (melangeYamlUpdated) {
      try {
        await enqueueWork("github_sync", {})
      } catch (syncErr) {
        console.warn("Failed to enqueue github_sync after package version update:", syncErr)
      }
    }
  } catch (error) {
    console.error(error);
    throw error;
  }

  return getPackageVersionById(pkgVersionId);
}

export async function checkForUpdates(pkgId: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `update package set check_for_updates_at = now() where id = $1`;
    await db.query(query, [pkgId]);
  } catch (error) {
    console.error(error);
    throw error;
  }
}
export async function createPackageVersionPatch(pkgId: string, versionLabel: string, filename: string, patch: string): Promise<Patch> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const id = srs.default({ length: 24, alphanumeric: true });

    const query = `select id from package_version where package_id = $1 and version = $2`;
    const result = await db.query(query, [pkgId, versionLabel]);
    const packageVersionId = result.rows[0].id;

    const query2 = `insert into package_version_patch
      (id, package_version_id, filename, patch, created_at)
      values ($1, $2, $3, $4, now())
      returning id, filename, patch`;
    const result2 = await db.query(query2, [id, packageVersionId, filename, patch]);

    return { id, filename, patch };
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function createPackageVersionPatchByRelease(pkgId: string, versionLabel: string, apkRelease: number, filename: string, patch: string): Promise<Patch> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const id = srs.default({ length: 24, alphanumeric: true });

    const query = `select id from package_version where package_id = $1 and version = $2 and apk_release = $3`;
    const result = await db.query(query, [pkgId, versionLabel, apkRelease]);

    if (result.rows.length === 0) {
      throw new Error(`Package version not found: ${versionLabel}-r${apkRelease}`);
    }

    const packageVersionId = result.rows[0].id;

    const query2 = `insert into package_version_patch
      (id, package_version_id, filename, patch, created_at)
      values ($1, $2, $3, $4, now())
      returning id, filename, patch`;
    const result2 = await db.query(query2, [id, packageVersionId, filename, patch]);

    return { id, filename, patch };
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function listPackageVersionPatches(pkgId: string, versionLabel: string): Promise<Patch[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id, filename, patch from package_version_patch where package_version_id IN (
      select id from package_version where package_id = $1 and version = $2
    )`;
    const result = await db.query(query, [pkgId, versionLabel]);

    const patches: Patch[] = [];
    for (const row of result.rows) {
      patches.push({ id: row.id, filename: row.filename, patch: row.patch });
    }

    return patches;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function listPackageVersionPatchesByRelease(pkgId: string, versionLabel: string, apkRelease: number): Promise<Patch[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id, filename, patch from package_version_patch where package_version_id = (
      select id from package_version where package_id = $1 and version = $2 and apk_release = $3
    )`;
    const result = await db.query(query, [pkgId, versionLabel, apkRelease]);

    const patches: Patch[] = [];
    for (const row of result.rows) {
      patches.push({ id: row.id, filename: row.filename, patch: row.patch });
    }

    return patches;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function listPackages(filters: PackageFilters, pagination: PaginationOptions): Promise<Package[]> {
  try {
    // Validate pagination parameters
    if (!Number.isInteger(pagination.page) || pagination.page < 1) {
      throw new Error("Page must be a positive integer");
    }
    if (!Number.isInteger(pagination.limit) || pagination.limit < 1 || pagination.limit > 1000) {
      throw new Error("Limit must be a positive integer between 1 and 1000");
    }

    const db = getDB(await getParam("DB_URI"));

    let query = `
      select p.id, p.name, p.created_at, p.updated_at, pv.version as last_version, pv.apk_release as last_apk_release,
             e.status as last_build_status, e.created_at as last_build_time
      from package p
      left join lateral (
        select version, apk_release
        from package_version
        where package_id = p.id
        order by created_at desc
        limit 1
      ) pv on true
      left join lateral (
        select status, created_at
        from execution
        where package_id = p.id and version_label = pv.version
        order by created_at desc
        limit 1
      ) e on true
    `;

    const queryParams: any[] = [];
    const whereClauses: string[] = [];

    // Search filter
    if (filters.search && filters.search.trim() !== "") {
      queryParams.push(`%${filters.search.trim()}%`);
      whereClauses.push(`p.name ILIKE $${queryParams.length}`);
    }

    // Status filter
    if (filters.status && filters.status !== "all") {
      queryParams.push(filters.status);
      whereClauses.push(`e.status = $${queryParams.length}`);
    }

    whereClauses.push("p.parent_id is null");

    if (whereClauses.length > 0) {
      query += ` where ` + whereClauses.join(" and ");
    }

    // Add ordering
    let orderBy = 'p.created_at desc';
    if (filters.sortField && filters.sortDirection) {
      const direction = filters.sortDirection === 'desc' ? 'desc' : 'asc';
      
      switch (filters.sortField) {
        case 'name':
          orderBy = `p.name ${direction}`;
          break;
        case 'version':
          orderBy = `pv.version ${direction} NULLS LAST`;
          break;
        case 'created':
          orderBy = `p.created_at ${direction}`;
          break;
        case 'status':
          orderBy = `e.status ${direction} NULLS LAST`;
          break;
        case 'lastBuild':
          orderBy = `e.created_at ${direction} NULLS LAST`;
          break;
        default:
          orderBy = 'p.created_at desc';
      }
    }
    
    query += ` order by ${orderBy}`;

    // Add pagination
    const offset = (pagination.page - 1) * pagination.limit;
    queryParams.push(pagination.limit, offset);
    query += ` limit $${queryParams.length - 1} offset $${queryParams.length}`;

    const result = await db.query(query, queryParams);

    const packages: Package[] = [];
    for (const row of result.rows) {
      packages.push({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        subpackages: [],
        lastVersion: row.last_version || "",
        lastAPKRelease: row.last_apk_release || 0,
        versionLabels: [],
        lastBuildTime: row.last_build_time,
        lastBuildStatus: row.last_build_status,
      });
    }

    for (const pkg of packages) {
      pkg.subpackages = await listSubpackages(db, pkg.id);
      pkg.versionLabels = await listPackageVersionLabels(pkg.id);
      pkg.versionInfos = await listPackageVersionInfos(pkg.id);
    }

    return packages;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function countPackages(filters: PackageFilters): Promise<number> {
  try {
    const db = getDB(await getParam("DB_URI"));

    let query = `
      select count(*)
      from package p
    `;

    // Add joins for status filtering if needed
    if (filters.status && filters.status !== "all") {
      query = `
        select count(*)
        from package p
        left join lateral (
          select version, apk_release
          from package_version
          where package_id = p.id
          order by created_at desc
          limit 1
        ) pv on true
        left join lateral (
          select status
          from execution
          where package_id = p.id and version_label = pv.version
          order by created_at desc
          limit 1
        ) e on true
      `;
    }

    const queryParams: any[] = [];
    const whereClauses: string[] = [];

    // Search filter
    if (filters.search && filters.search.trim() !== "") {
      queryParams.push(`%${filters.search.trim()}%`);
      whereClauses.push(`p.name ILIKE $${queryParams.length}`);
    }

    // Status filter
    if (filters.status && filters.status !== "all") {
      queryParams.push(filters.status);
      whereClauses.push(`e.status = $${queryParams.length}`);
    }

    whereClauses.push("p.parent_id is null");

    if (whereClauses.length > 0) {
      query += ` where ` + whereClauses.join(" and ");
    }

    const result = await db.query(query, queryParams);
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error(error);
    throw error;
  }
}

async function getLastBuild(pkgId: string, versionLabel: string): Promise<PackageBuild | null> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id, created_at, status from execution where package_id = $1 and version_label = $2 order by created_at desc limit 1`;
    const result = await db.query(query, [pkgId, versionLabel]);

    if (result.rows.length === 0) {
      return null;
    }

    const pb: PackageBuild = {
      id: result.rows[0].id,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].created_at,
      status: result.rows[0].status,
    }

    return pb;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getMostRecentPackageVersion(pkgId: string): Promise<PackageVersion> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id from package_version where package_id = $1 order by created_at desc limit 1`;
    const result = await db.query(query, [pkgId]);

    return getPackageVersionById(result.rows[0].id);
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function getPackageVersionById(id: string): Promise<PackageVersion> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id, package_id, created_at, updated_at, version, melange_yaml, apk_release, use_root, bootstrap_enabled, bootstrap_apk_repository, bootstrap_keyring_append, custom_disk_size, git_remote, melange_file_path, git_tag, git_commit_sha from package_version where id = $1`;
    const result = await db.query(query, [id]);

    return {
      id: result.rows[0].id,
      packageId: result.rows[0].package_id,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
      version: result.rows[0].version,
      melangeYaml: result.rows[0].melange_yaml,
      apkRelease: result.rows[0].apk_release,
      useRoot: result.rows[0].use_root,
      bootstrapEnabled: result.rows[0].bootstrap_enabled,
      bootstrapApkRepository: result.rows[0].bootstrap_apk_repository,
      bootstrapKeyringAppend: result.rows[0].bootstrap_keyring_append,
      customDiskSize: result.rows[0].custom_disk_size,
      gitRemote: result.rows[0].git_remote || undefined,
      melangeFilePath: result.rows[0].melange_file_path || undefined,
      gitTag: result.rows[0].git_tag || undefined,
      gitCommitSha: result.rows[0].git_commit_sha || undefined,
    }
  } catch (error) {
    console.error(error);
    throw error;
  }
}
export async function getPackageVersion(pkgId: string, versionLabel: string, apkRelease: number): Promise<PackageVersion> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id, package_id, created_at, updated_at, version, melange_yaml, apk_release, use_root, bootstrap_enabled, bootstrap_apk_repository, bootstrap_keyring_append, custom_disk_size, git_remote, melange_file_path, git_tag, git_commit_sha from package_version where package_id = $1 and version = $2 and apk_release = $3`;
    const result = await db.query(query, [pkgId, versionLabel, apkRelease]);

    return {
      id: result.rows[0].id,
      packageId: result.rows[0].package_id,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
      version: result.rows[0].version,
      melangeYaml: result.rows[0].melange_yaml,
      apkRelease: result.rows[0].apk_release,
      useRoot: result.rows[0].use_root,
      bootstrapEnabled: result.rows[0].bootstrap_enabled,
      bootstrapApkRepository: result.rows[0].bootstrap_apk_repository,
      bootstrapKeyringAppend: result.rows[0].bootstrap_keyring_append,
      customDiskSize: result.rows[0].custom_disk_size,
      gitRemote: result.rows[0].git_remote || undefined,
      melangeFilePath: result.rows[0].melange_file_path || undefined,
      gitTag: result.rows[0].git_tag || undefined,
      gitCommitSha: result.rows[0].git_commit_sha || undefined,
    }
  } catch (error) {
    console.error(error);
    throw error;
  }
}
export async function getPackageVersionByVersionAndRelease(pkgId: string, versionLabel: string, apkRelease: number): Promise<PackageVersion> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id, package_id, created_at, updated_at, version, melange_yaml, apk_release, use_root, bootstrap_enabled, bootstrap_apk_repository, bootstrap_keyring_append, custom_disk_size, git_remote, melange_file_path, git_tag, git_commit_sha from package_version where package_id = $1 and version = $2 and apk_release = $3`;
    const result = await db.query(query, [pkgId, versionLabel, apkRelease]);

    if (result.rows.length === 0) {
      throw new Error(`Package version not found: ${versionLabel}-r${apkRelease}`);
    }

    return {
      id: result.rows[0].id,
      packageId: result.rows[0].package_id,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
      version: result.rows[0].version,
      melangeYaml: result.rows[0].melange_yaml,
      apkRelease: result.rows[0].apk_release,
      useRoot: result.rows[0].use_root,
      bootstrapEnabled: result.rows[0].bootstrap_enabled,
      bootstrapApkRepository: result.rows[0].bootstrap_apk_repository,
      bootstrapKeyringAppend: result.rows[0].bootstrap_keyring_append,
      customDiskSize: result.rows[0].custom_disk_size,
      gitRemote: result.rows[0].git_remote || undefined,
      melangeFilePath: result.rows[0].melange_file_path || undefined,
      gitTag: result.rows[0].git_tag || undefined,
      gitCommitSha: result.rows[0].git_commit_sha || undefined,
    }
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function listPackageVersionBuildDependencies(id: string): Promise<PackageDependency[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      select depends_on_package_id, depends_on_package_name, depends_on_package_version_id, depends_on_package_is_external
      from package_version_dependency_buildtime
      where package_version_id = $1
      order by depends_on_package_name asc
    `;
    const result = await db.query(query, [id]);

    const dependencies: PackageDependency[] = [];
    for (const row of result.rows) {
      let status: string | undefined;
      if (row.depends_on_package_version_id) {
        const lastBuild = await getLastExecutionForPackageVersion(row.depends_on_package_version_id);
        if (lastBuild) {
          status = lastBuild.status;
        }
      }
      dependencies.push({
        packageId: row.depends_on_package_id,
        packageName: row.depends_on_package_name,
        packageVersion: row.depends_on_package_version_id ? (await getPackageVersionById(row.depends_on_package_version_id)).version : "",
        packageVersionId: row.depends_on_package_version_id,
        packageVersionAPKRelease: row.depends_on_package_version_id ? (await getPackageVersionById(row.depends_on_package_version_id)).apkRelease! : 0,
        status,
        isExternalDependency: row.depends_on_package_is_external,
      });
    }
    return dependencies;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function setDeleteProtection(id: string, isDeleteProtectionEnabled: boolean): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `update package set is_delete_protection_enabled = $1 where id = $2`;
    await db.query(query, [isDeleteProtectionEnabled, id]);
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function listPackageVersionRuntimeDependencies(id: string): Promise<PackageDependency[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      select depends_on_package_id, depends_on_package_name, depends_on_package_version_id, depends_on_package_is_external
      from package_version_dependency_runtime
      where package_version_id = $1
      order by depends_on_package_name asc
    `;
    const result = await db.query(query, [id]);

    const dependencies: PackageDependency[] = [];
    for (const row of result.rows) {
      let status: string | undefined;
      if (row.depends_on_package_version_id) {
        const lastBuild = await getLastExecutionForPackageVersion(row.depends_on_package_version_id);
        if (lastBuild) {
          status = lastBuild.status;
        }
      }
      dependencies.push({
        packageId: row.depends_on_package_id,
        packageName: row.depends_on_package_name,
        packageVersion: row.depends_on_package_version_id ? (await getPackageVersionById(row.depends_on_package_version_id)).version : "",
        packageVersionId: row.depends_on_package_version_id,
        packageVersionAPKRelease: row.depends_on_package_version_id ? (await getPackageVersionById(row.depends_on_package_version_id)).apkRelease! : 0,
        status,
        isExternalDependency: row.depends_on_package_is_external,
      });
    }
    return dependencies;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function listPackageVersionBuildDependents(packageId: string): Promise<PackageDependency[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      SELECT DISTINCT pv.package_id, d.package_name
      FROM package_version_dependency_buildtime d
      JOIN package_version pv ON d.package_version_id = pv.id
      WHERE d.depends_on_package_id = $1
      ORDER BY d.package_name ASC
    `;
    const result = await db.query(query, [packageId]);

    const dependents: PackageDependency[] = [];
    for (const row of result.rows) {
      dependents.push({
        packageId: row.package_id,
        packageName: row.package_name,
        packageVersion: "",
        packageVersionId: "",
        packageVersionAPKRelease: 0,
        status: undefined,
        isExternalDependency: false,
      });
    }
    return dependents;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function listPackageVersionRuntimeDependents(packageId: string): Promise<PackageDependency[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      SELECT DISTINCT pv.package_id, d.package_name
      FROM package_version_dependency_runtime d
      JOIN package_version pv ON d.package_version_id = pv.id
      WHERE d.depends_on_package_id = $1
      ORDER BY d.package_name ASC
    `;
    const result = await db.query(query, [packageId]);

    const dependents: PackageDependency[] = [];
    for (const row of result.rows) {
      dependents.push({
        packageId: row.package_id,
        packageName: row.package_name,
        packageVersion: "",
        packageVersionId: "",
        packageVersionAPKRelease: 0,
        status: undefined,
        isExternalDependency: false,
      });
    }
    return dependents;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function getPackageByName(name: string): Promise<Package> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id from package where name = $1`;
    const result = await db.query(query, [name]);

    if (result.rows.length === 0) {
      throw new Error(`Package not found: ${name}`);
    }

    const id = result.rows[0].id;
    return getPackage(id);
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function tryGetPackageByName(name: string): Promise<Package | null> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id from package where name = $1`;
    const result = await db.query(query, [name]);

    if (result.rows.length === 0) {
      return null;
    }

    const id = result.rows[0].id;
    return getPackage(id);
  } catch (error) {
    console.error(error);
    throw error;
  }
}


export async function getPackage(id: string): Promise<Package> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      select p.id, p.name, p.created_at, p.updated_at, p.is_delete_protection_enabled, p.parent_id, 
             pv.version as last_version, pv.apk_release as last_apk_release,
             parent.name as parent_name
      from package p
      left join lateral (
        select version, apk_release
        from package_version
        where package_id = p.id
        order by created_at desc
        limit 1
      ) pv on true
      left join package parent on p.parent_id = parent.id
      where p.id = $1
    `;
    const result = await db.query(query, [id]);

    const p: Package = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
      isDeleteProtectionEnabled: result.rows[0].is_delete_protection_enabled,
      subpackages: [],
      lastVersion: result.rows[0].last_version || "",
      lastAPKRelease: result.rows[0].last_apk_release || 0,
      versionLabels: [],
      parentId: result.rows[0].parent_id,
      parentName: result.rows[0].parent_name,
    }

    p.subpackages = await listSubpackages(db, p.id);
    p.versionLabels = await listPackageVersionLabels(p.id);
    p.versionInfos = await listPackageVersionInfos(p.id);

    return p;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

async function listPackageVersionLabels(id: string): Promise<string[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select version from package_version where package_id = $1`;
    const result = await db.query(query, [id]);

    return result.rows.map((row) => row.version);
  } catch (error) {
    console.error(error);
    throw error;
  }
}

async function listPackageVersionInfos(id: string): Promise<VersionInfo[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select version, apk_release from package_version where package_id = $1`;
    const result = await db.query(query, [id]);

    return result.rows.map((row: any) => ({
      version: row.version,
      apkRelease: row.apk_release || 0
    }));
  } catch (error) {
    console.error(error);
    throw error;
  }
}

async function listSubpackages(client: Pool | PoolClient, id: string): Promise<Package[]> {
  const query = `select p.id, p.name, p.created_at, p.updated_at, pv.version as last_version, pv.apk_release as last_apk_release
  from package p
  left join lateral (
    select version, apk_release
    from package_version
    where package_id = p.id
    order by created_at desc
    limit 1
  ) pv on true
  where parent_id = $1 and is_deleted = false`;
  const result = await client.query(query, [id]);

  const packages: Package[] = [];
  for (const row of result.rows) {
    packages.push({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      subpackages: [],
      lastVersion: row.last_version || "",
      lastAPKRelease: row.last_apk_release || 0,
      versionLabels: [],
    });
  }

  return packages;
}

export function bumpReleaseInMelangeYAML(melangeYAML: string, release: number): string {
  const lines = melangeYAML.split('\n');
  let epochFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('epoch:')) {
      // Extract the leading whitespace
      const leadingWhitespace = line.substring(0, line.length - trimmed.length);
      
      // Replace the line with the same whitespace + new epoch value
      lines[i] = `${leadingWhitespace}epoch: ${release}`;
      epochFound = true;
      break;
    }
  }

  if (!epochFound) {
    throw new Error('epoch field not found in melange YAML');
  }

  return lines.join('\n');
}

export async function validateEpochValue(melangeYaml: string, existingVersion: PackageVersion): Promise<{ isValid: boolean; error?: string }> {
  try {
    const parsed = yaml.load(melangeYaml) as any;
    if (!parsed?.package || typeof parsed.package.epoch === 'undefined') {
      return { isValid: false, error: 'Epoch value is not specified in the melange YAML' };
    }

    const epochValue = parsed.package.epoch;
    if (typeof epochValue !== 'number') {
      return { isValid: false, error: 'Epoch value must be a number' };
    }

    const nextRelease = (existingVersion.apkRelease || 0) + 1;

    // If epoch is 0 or matches the next release number, it's valid
    if (epochValue === 0 || epochValue === nextRelease) {
      return { isValid: true };
    }

    return { 
      isValid: false, 
      error: `Epoch value ${epochValue} does not match the next release number ${nextRelease}` 
    };
  } catch (err) {
    return { isValid: false, error: `Failed to parse melange YAML: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}

export async function getLatestRevisionByVersion(pkgId: string, version: string): Promise<PackageVersion | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT
        id,
        package_id,
        created_at,
        updated_at,
        version,
        melange_yaml,
        apk_release,
        use_root,
        bootstrap_enabled,
        bootstrap_apk_repository,
        bootstrap_keyring_append,
        custom_disk_size
      FROM package_version
      WHERE package_id = $1 AND version = $2
      ORDER BY apk_release DESC
      LIMIT 1
    `;
    const result = await db.query(query, [pkgId, version]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      packageId: row.package_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      melangeYaml: row.melange_yaml,
      apkRelease: row.apk_release,
      useRoot: row.use_root,
      bootstrapEnabled: row.bootstrap_enabled,
      bootstrapApkRepository: row.bootstrap_apk_repository,
      bootstrapKeyringAppend: row.bootstrap_keyring_append,
      customDiskSize: row.custom_disk_size
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function createPackageRelease(
  pkgId: string,
  version: string,
  melangeYaml: string,
  additionalFiles?: AdditionalFiles,
  copyFilesFromExisting: boolean = false
): Promise<PackageVersion> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const id = srs.default({ length: 24, alphanumeric: true });

    // Get the current version to determine the next release number
    const currentVersion = await getLatestRevisionByVersion(pkgId, version);
    if (!currentVersion) {
      throw new ValidationError(`Version ${version} not found`);
    }

    const newRelease = (currentVersion.apkRelease || 0) + 1;

    // Get new subpackages from melange YAML
    const newSubpackages = await getSubpackagesFromMelangeYaml(melangeYaml);

    await withTransaction(db, async (client) => {
      // Get current subpackages from database
      const currentSubpackages = await listSubpackages(client, pkgId);
      // Insert new package version
      const query = `insert into package_version (id, package_id, version, melange_yaml, created_at, updated_at, apk_release, use_root) values ($1, $2, $3, $4, now(), now(), $5, $6)`;
      await client.query(query, [id, pkgId, version, melangeYaml, newRelease, currentVersion.useRoot]);

      // Update provides data
      const { writePackageVersionProvides } = await import('./provides');
      await writePackageVersionProvides(client, id, melangeYaml);

      // Handle additional files
      if (copyFilesFromExisting) {
        // Copy additional files directly from the existing version (UI path)
        const existingFiles = await listPackageVersionAdditionalFiles(currentVersion.id!);
        for (const file of existingFiles) {
          const additionalFileId = srs.default({ length: 24, alphanumeric: true });
          const query = `insert into package_version_additional_file (id, package_version_id, path, content, created_at, updated_at) values ($1, $2, $3, $4, now(), now())`;
          await client.query(query, [additionalFileId, id, file.path, file.content]);
        }
      } else if (additionalFiles) {
        // Decode and extract provided additional files (API/CLI path)
        const extractedFiles = await decodeAndExtractAdditionalFiles(additionalFiles);
        for (const file of extractedFiles) {
          const additionalFileId = srs.default({ length: 24, alphanumeric: true });
          const query = `insert into package_version_additional_file (id, package_version_id, path, content, created_at, updated_at) values ($1, $2, $3, $4, now(), now())`;
          await client.query(query, [additionalFileId, id, file.path, file.content]);
        }
      }

      await updateSubpackagesInDB(client, pkgId, newSubpackages, currentSubpackages);
    });

    return getPackageVersionById(id);
  } catch(err) {
    console.error(err);
    throw err;
  }
}

export async function createPackageVersion(pkgId: string, version: string): Promise<PackageVersion> {
  const currentPackageVersion = await getMostRecentPackageVersion(pkgId);
  const additionalFiles = await listPackageVersionAdditionalFiles(currentPackageVersion.id!);

  if (currentPackageVersion.apkRelease === undefined) {
    throw new Error("No package version found");
  }

  try {
    const db = getDB(await getParam("DB_URI"));
    const id = srs.default({ length: 24, alphanumeric: true });

    // If version is provided, set release to 0 (new version), otherwise increment release
    const newRelease = version ? 0 : (currentPackageVersion.apkRelease || 0) + 1;
    const newVersion = version || currentPackageVersion.version;
    
    let updatedMelangeYaml: string;
    if (version) {
      // Update version in melange YAML
      updatedMelangeYaml = changeVersionInMelangeYAML(currentPackageVersion.melangeYaml, version);
    } else {
      // Just bump the release number
      updatedMelangeYaml = bumpReleaseInMelangeYAML(currentPackageVersion.melangeYaml, newRelease);
    }

    await withTransaction(db, async (client) => {
      const query = `insert into package_version (id, package_id, version, melange_yaml, created_at, updated_at, apk_release, use_root) values ($1, $2, $3, $4, now(), now(), $5, $6)`;
      await client.query(query, [id, pkgId, newVersion, updatedMelangeYaml, newRelease, currentPackageVersion.useRoot]);

      // Update provides data
      const { writePackageVersionProvides } = await import('./provides');
      await writePackageVersionProvides(client, id, updatedMelangeYaml);

      // copy all additional files
      for (const additionalFile of additionalFiles) {
        const additionalFileId = srs.default({ length: 24, alphanumeric: true });
        const query = `insert into package_version_additional_file (id, package_version_id, path, content, created_at, updated_at) values ($1, $2, $3, $4, now(), now())`;
        await client.query(query, [additionalFileId, id, additionalFile.path, additionalFile.content]);
      }
    })

    // Trigger GitHub sync after package version creation
    try {
      await enqueueWork("github_sync", {})
    } catch (syncErr) {
      console.warn("Failed to enqueue github_sync after package version creation:", syncErr)
    }

    return getPackageVersionById(id);
  } catch(err) {
    console.error(err);
    throw err;
  }
}

export async function deletePackageRelease(pkgId: string, version: string, apkRelease: number): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // First, get the package version ID
    const versionQuery = `
      SELECT id FROM package_version 
      WHERE package_id = $1 AND version = $2 AND apk_release = $3
    `;
    const versionResult = await db.query(versionQuery, [pkgId, version, apkRelease]);

    if (versionResult.rows.length === 0) {
      throw new Error("Package version not found");
    }

    const packageVersionId = versionResult.rows[0].id;

    // Check if this is the only version - prevent deletion if so
    const countQuery = `
      SELECT COUNT(*) as count FROM package_version
      WHERE package_id = $1
    `;
    const countResult = await db.query(countQuery, [pkgId]);
    const versionCount = parseInt(countResult.rows[0].count);

    if (versionCount <= 1) {
      throw new Error("Cannot delete the last remaining version of a package");
    }

    // Get all packages (main + subpackages) for APK withdrawal
    const packageQuery = `
      SELECT p.name
      FROM package p
      WHERE p.id = $1 OR p.parent_id = $1
    `;
    const packageResult = await db.query(packageQuery, [pkgId]);
    const packages = packageResult.rows;

    // Get all package version IDs to delete (main package + subpackages with same version/release)
    const allVersionIdsQuery = `
      SELECT pv.id
      FROM package_version pv
      INNER JOIN package p ON p.id = pv.package_id
      WHERE (p.id = $1 OR p.parent_id = $1)
        AND pv.version = $2
        AND pv.apk_release = $3
    `;
    const allVersionIdsResult = await db.query(allVersionIdsQuery, [pkgId, version, apkRelease]);
    const packageVersionIds = allVersionIdsResult.rows.map((row: any) => row.id);

    if (packageVersionIds.length === 0) {
      throw new Error("No package versions found to delete");
    }

    await withTransaction(db, async (client) => {
      // Mark APKs as withdrawn in the apk_catalog for all packages (main + subpackages)
      // The background listener will handle the actual deletion
      const versionString = `${version}-r${apkRelease}`;
      for (const pkg of packages) {
        const filenamePattern = `${pkg.name}-${versionString}.apk`;
        await client.query(`
          UPDATE apk_catalog
          SET is_withdrawn = true
          WHERE filename = $1;
        `, [filenamePattern]);
      }

      // Delete all related data for all package versions (main + subpackages)
      for (const versionId of packageVersionIds) {
        await client.query(`
          WITH deleted_runtime_deps AS (
            DELETE FROM package_version_dependency_runtime
            WHERE package_version_id = $1 OR depends_on_package_version_id = $1
          ),
          deleted_buildtime_deps AS (
            DELETE FROM package_version_dependency_buildtime
            WHERE package_version_id = $1 OR depends_on_package_version_id = $1
          ),
          deleted_additional_files AS (
            DELETE FROM package_version_additional_file
            WHERE package_version_id = $1
          ),
          deleted_patches AS (
            DELETE FROM package_version_patch
            WHERE package_version_id = $1
          ),
          deleted_executions AS (
            DELETE FROM execution
            WHERE package_version_id = $1
          ),
          deleted_build_queue AS (
            DELETE FROM build_queue
            WHERE package_version_id = $1
          ),
          deleted_provides AS (
            DELETE FROM package_version_provides
            WHERE package_version_id = $1
          )
          DELETE FROM package_version WHERE id = $1
        `, [versionId]);
      }
    });

  } catch(err) {
    console.error(err);
    throw err;
  }
}

// Replace version and epoch in melange YAML, but only if it's inside the package section.
// This function does this without parsing and re-serializing the YAML to preserve overall structure and formatting.
function changeVersionInMelangeYAML(melangeYaml: string, version: string): string {
  const lines = melangeYaml.split('\n');
  let inPackageSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Check if we're entering the package section (must start at beginning of line)
    if (line.startsWith('package:')) {
      inPackageSection = true;
      continue;
    }
    
    // Check if we've left the package section (any non-whitespace line that doesn't start with space)
    if (inPackageSection && trimmed !== '' && !line.startsWith(' ') && !line.startsWith('\t') && !line.startsWith('#')) {
      inPackageSection = false;
    }
    
    // Only update version and epoch if we're inside the package section and line is indented
    if (inPackageSection && (line.startsWith(' ') || line.startsWith('\t'))) {
      if (trimmed.startsWith('version:')) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          lines[i] = `${parts[0]}: "${version}"`;
        }
      }
      
      if (trimmed.startsWith('epoch:')) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          lines[i] = `${parts[0]}: 0`;
        }
      }
    }
  }
  
  return lines.join('\n');
}

export async function listPackageVersionAdditionalFiles(id: string): Promise<AdditionalFile[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id, path, content, created_at, updated_at from package_version_additional_file where package_version_id = $1`;
    const result = await db.query(query, [id]);

    const additionalFiles: AdditionalFile[] = [];
    for (const row of result.rows) {
      additionalFiles.push({
        id: row.id,
        path: row.path,
        content: row.content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }

    return additionalFiles;
  } catch (err) {
    console.error(err);
    throw err;
  }
}
export async function createPackage(melangeYaml: string, additionalFiles?: AdditionalFiles, useRoot?: boolean, userId?: string, userName?: string): Promise<string> {
  logger.debug("Creating package", { melangeYaml, hasAdditionalFiles: !!additionalFiles, userId, userName })
  try {
    const db = getDB(await getParam("DB_URI"));

    // Generate IDs for both the temporary record and the actual package
    const tempId = srs.default({ length: 24, alphanumeric: true });
    // Generate a 32-byte hex string for the package ID to match Go implementation
    // Use crypto.randomBytes to generate 32 random bytes, then convert to hex (64 chars)
    const packageId = crypto.randomBytes(32).toString('hex');
    
    // Extract package name from melange YAML
    const packageInfo = extractPackageInfoFromMelange(melangeYaml);
    if (!packageInfo.name) {
      throw new ValidationError('Package name not found in melange YAML');
    }

    // Use a transaction to ensure both records are created atomically
    await withTransaction(db, async (client) => {
      // First check if package with this name already exists
      const checkQuery = `select id from package where name = $1`;
      const checkResult = await client.query(checkQuery, [packageInfo.name]);
      
      if (checkResult.rows.length > 0) {
        throw new ValidationError(`Package with name '${packageInfo.name}' already exists`);
      }
      
      // Create the actual package record
      const packageQuery = `insert into package (id, name, created_at, updated_at) 
                           values ($1, $2, now(), now()) 
                           returning id`;
      const packageResult = await client.query(packageQuery, [packageId, packageInfo.name]);
      const actualPackageId = packageResult.rows[0].id;

      // Create the temporary package_create record with the link to the actual package
      const createQuery = `insert into package_create (id, melange_yaml, additional_files_data, use_root, package_id, created_by_user_id, created_by_user_name, created_at)
                          values ($1, $2, $3, $4, $5, $6, $7, now())`;
      await client.query(createQuery, [
        tempId,
        melangeYaml,
        additionalFiles?.data || null,
        useRoot || false,
        actualPackageId,
        userId || null,
        userName || null
      ]);

      // Enqueue the work with the temporary ID (handleCreatePackage expects this)
      await enqueueWork("create_package", {
        id: tempId,
      });
    });

    // Return the actual package ID, not the temporary one
    return packageId;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function convertPackageToInternal(id: string, melangeYaml: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `insert into package_create (id, melange_yaml, created_at) values ($1, $2, now())`;
    await db.query(query, [id, melangeYaml]);

    await enqueueWork("create_package", {
      id,
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function getLastExecutionForPackageVersion(packageVersionId: string): Promise<PackageBuild | null> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id, created_at, status from execution where package_version_id = $1 order by created_at desc limit 1`;
    const result = await db.query(query, [packageVersionId]);

    if (result.rows.length === 0) {
      return null;
    }

    const pb: PackageBuild = {
      id: result.rows[0].id,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].created_at,
      status: result.rows[0].status,
    }

    return pb;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function listPackageImages(packageId: string): Promise<{id: string, name: string}[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      SELECT DISTINCT i.id, i.name
      FROM image i
      INNER JOIN image_package ip ON i.id = ip.image_id
      WHERE ip.package_id = $1
      ORDER BY i.name ASC
    `;
    const result = await db.query(query, [packageId]);

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
    }));
  } catch (error) {
    console.error(error);
    throw error;
  }
}

/**
 * Withdraw a package from the APK repository by marking it as withdrawn in apk_catalog.
 * This function is architecture agnostic - it will mark all records with the given filename
 * as withdrawn, regardless of architecture.
 * 
 * @param filename - The APK filename (e.g., "package-1.0.0-r0.apk")
 * @throws ValidationError with status 404 if no records match the filename
 */
export async function withdrawPackage(filename: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Update all records with this filename (architecture agnostic)
    // Use rowCount to atomically check if any rows were updated
    const result = await db.query(
      `UPDATE apk_catalog SET is_withdrawn = true WHERE filename = $1`,
      [filename]
    );

    if (result.rowCount === 0) {
      throw new ValidationError(`No APK catalog records found for filename: ${filename}`, 404);
    }
  } catch (error) {
    console.error(error);
    throw error;
  }
}
