import { PoolClient } from "pg";
import { getDB } from "@/lib/data/db";
import { PackageFamily, PackageFamilyWithPackages, PackageFamilyPackage, CreatePackageFamilyRequest, UpdatePackageFamilyRequest } from "@/lib/types/packagefamily";
import { randomBytes } from "crypto";
import semver from "semver";
import * as yaml from "js-yaml";

export async function listPackageFamilies(): Promise<PackageFamily[]> {
  const pool = getDB(process.env.DB_URI!);
  const client = await pool.connect();
  
  try {
    const query = `
      SELECT id, name, monitoring_enabled,
             check_frequency_minutes, version_pattern,
             major_version_filter, package_name_template,
             dry_run_mode, min_version, notify_on_detection,
             notify_on_build_failure, check_for_updates_at, last_check_at,
             last_error, consecutive_errors, created_at, updated_at,
             image_tag_template
      FROM package_family
      ORDER BY name ASC`;

    const result = await client.query(query);
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      monitoringEnabled: row.monitoring_enabled,
      checkFrequencyMinutes: row.check_frequency_minutes,
      versionPattern: row.version_pattern,
      majorVersionFilter: row.major_version_filter,
      packageNameTemplate: row.package_name_template,
      dryRunMode: row.dry_run_mode,
      minVersion: row.min_version,
      notifyOnDetection: row.notify_on_detection,
      notifyOnBuildFailure: row.notify_on_build_failure,
      checkForUpdatesAt: new Date(row.check_for_updates_at),
      lastCheckAt: row.last_check_at ? new Date(row.last_check_at) : undefined,
      lastError: row.last_error,
      consecutiveErrors: row.consecutive_errors,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      imageTagTemplate: row.image_tag_template,
    }));
  } finally {
    client.release();
  }
}

export async function getPackageFamily(id: string): Promise<PackageFamily | null> {
  const pool = getDB(process.env.DB_URI!);
  const client = await pool.connect();
  
  try {
    const query = `
      SELECT id, name, monitoring_enabled,
             check_frequency_minutes, version_pattern,
             major_version_filter, package_name_template,
             dry_run_mode, min_version, notify_on_detection,
             notify_on_build_failure, check_for_updates_at, last_check_at,
             last_error, consecutive_errors, created_at, updated_at,
             image_tag_template
      FROM package_family
      WHERE id = $1`;

    const result = await client.query(query, [id]);
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      monitoringEnabled: row.monitoring_enabled,
      checkFrequencyMinutes: row.check_frequency_minutes,
      versionPattern: row.version_pattern,
      majorVersionFilter: row.major_version_filter,
      packageNameTemplate: row.package_name_template,
      dryRunMode: row.dry_run_mode,
      minVersion: row.min_version,
      notifyOnDetection: row.notify_on_detection,
      notifyOnBuildFailure: row.notify_on_build_failure,
      checkForUpdatesAt: new Date(row.check_for_updates_at),
      lastCheckAt: row.last_check_at ? new Date(row.last_check_at) : undefined,
      lastError: row.last_error,
      consecutiveErrors: row.consecutive_errors,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      imageTagTemplate: row.image_tag_template,
    };
  } finally {
    client.release();
  }
}

export async function getPackageFamilyWithPackages(id: string): Promise<PackageFamilyWithPackages | null> {
  const packageFamily = await getPackageFamily(id);
  if (!packageFamily) {
    return null;
  }
  
  const packages = await getPackageFamilyPackages(id);
  
  return {
    ...packageFamily,
    packages,
  };
}

export async function getPackageFamilyPackages(packageFamilyId: string): Promise<PackageFamilyPackage[]> {
  const pool = getDB(process.env.DB_URI!);
  const client = await pool.connect();

  try {
    // First, get the package family to access its name, template, and pattern
    const packageFamily = await getPackageFamily(packageFamilyId);
    if (!packageFamily) {
      return [];
    }

    // Query all packages matching the family name pattern with parent_id IS NULL
    // Get all versions for each package with their latest execution - we'll find the latest in code
    const candidateQuery = `
      SELECT DISTINCT p.id, p.name, pv.id as package_version_id, pv.version, p.created_at,
        e.id as last_execution_id,
        e.status as last_execution_status,
        e.created_at as last_execution_created_at
      FROM package p
      INNER JOIN package_version pv ON p.id = pv.package_id
      LEFT JOIN LATERAL (
        SELECT id, status, created_at
        FROM execution
        WHERE package_version_id = pv.id
        ORDER BY created_at DESC
        LIMIT 1
      ) e ON true
      WHERE p.name LIKE $1 AND p.parent_id IS NULL`;

    const familyPattern = packageFamily.name + '-%';
    const result = await client.query(candidateQuery, [familyPattern]);

    if (result.rows.length === 0) {
      return [];
    }

    // Group by package ID and find latest version per package
    const packageVersionsMap = new Map<string, Array<{
      name: string;
      version: string;
      parsedVersion: semver.SemVer;
      createdAt: Date;
      lastExecutionId: string | null;
      lastExecutionStatus: string | null;
      lastExecutionCreatedAt: Date | null;
    }>>();

    for (const row of result.rows) {
      // Use coerce to handle versions like "5.3" (missing patch) -> "5.3.0"
      const parsedVersion = semver.coerce(row.version);
      if (!parsedVersion) {
        continue;
      }

      // Generate expected package name from template
      const expectedName = packageFamily.packageNameTemplate
        .replace('{name}', packageFamily.name)
        .replace('{major}', parsedVersion.major.toString())
        .replace('{minor}', parsedVersion.minor.toString());

      // Check if actual package name matches expected name
      if (row.name === expectedName) {
        if (!packageVersionsMap.has(row.id)) {
          packageVersionsMap.set(row.id, []);
        }
        packageVersionsMap.get(row.id)!.push({
          name: row.name,
          version: row.version,
          parsedVersion: parsedVersion,
          createdAt: new Date(row.created_at),
          lastExecutionId: row.last_execution_id || null,
          lastExecutionStatus: row.last_execution_status || null,
          lastExecutionCreatedAt: row.last_execution_created_at ? new Date(row.last_execution_created_at) : null,
        });
      }
    }

    // For each package, find the latest version using semver ordering
    const familyPackages: PackageFamilyPackage[] = [];

    for (const [packageId, versions] of packageVersionsMap.entries()) {
      // Sort versions by semver (descending), then by execution presence
      versions.sort((a, b) => {
        // First compare by semver
        const semverCmp = semver.rcompare(a.parsedVersion, b.parsedVersion);
        if (semverCmp !== 0) return semverCmp;

        // If versions are equal, prefer one with execution data
        const aHasExecution = a.lastExecutionId !== null;
        const bHasExecution = b.lastExecutionId !== null;
        if (aHasExecution && !bHasExecution) return -1;
        if (!aHasExecution && bHasExecution) return 1;

        // If both have or don't have execution, prefer the one with more recent execution
        if (a.lastExecutionCreatedAt && b.lastExecutionCreatedAt) {
          return b.lastExecutionCreatedAt.getTime() - a.lastExecutionCreatedAt.getTime();
        }

        return 0;
      });
      const latestVersion = versions[0];

      familyPackages.push({
        packageFamilyId: packageFamilyId,
        packageId: packageId,
        version: latestVersion.version,
        isTemplate: false,
        createdAt: latestVersion.createdAt,
        packageName: latestVersion.name,
        lastExecutionId: latestVersion.lastExecutionId,
        lastExecutionStatus: latestVersion.lastExecutionStatus,
        lastExecutionCreatedAt: latestVersion.lastExecutionCreatedAt,
      });
    }

    // Sort packages by version (descending) using semver
    familyPackages.sort((a, b) => {
      const aVersion = semver.coerce(a.version);
      const bVersion = semver.coerce(b.version);
      if (!aVersion || !bVersion) return 0;
      return semver.rcompare(aVersion, bVersion);
    });

    return familyPackages;
  } finally {
    client.release();
  }
}

export async function createPackageFamily(req: CreatePackageFamilyRequest): Promise<PackageFamily> {
  const pool = getDB(process.env.DB_URI!);
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const id = randomBytes(16).toString('hex');
    const now = new Date();
    // Initial check: random time within next 12 hours to distribute load
    const randomHours = Math.random() * 12;
    const checkAt = new Date(now.getTime() + randomHours * 60 * 60 * 1000);
    
    const query = `
      INSERT INTO package_family (
        id, name, monitoring_enabled,
        check_frequency_minutes, version_pattern,
        major_version_filter, package_name_template,
        dry_run_mode, min_version, notify_on_detection,
        notify_on_build_failure, check_for_updates_at, consecutive_errors,
        created_at, updated_at, image_tag_template
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      )`;

    await client.query(query, [
      id, req.name, req.monitoringEnabled,
      req.checkFrequencyMinutes, req.versionPattern,
      req.majorVersionFilter, req.packageNameTemplate,
      req.dryRunMode, req.minVersion, req.notifyOnDetection,
      req.notifyOnBuildFailure, checkAt, 0, now, now,
      req.imageTagTemplate || null,
    ]);

    // Note: Packages are now dynamically discovered based on naming pattern
    // No need to explicitly link packages via junction table

    await client.query('COMMIT');
    
    const created = await getPackageFamily(id);
    if (!created) {
      throw new Error('Failed to create package family');
    }
    
    return created;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePackageFamily(id: string, req: UpdatePackageFamilyRequest): Promise<PackageFamily | null> {
  const pool = getDB(process.env.DB_URI!);
  const client = await pool.connect();
  
  try {
    const setParts: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (req.name !== undefined) {
      setParts.push(`name = $${paramIndex}`);
      values.push(req.name);
      paramIndex++;
    }
    if (req.monitoringEnabled !== undefined) {
      setParts.push(`monitoring_enabled = $${paramIndex}`);
      values.push(req.monitoringEnabled);
      paramIndex++;
    }
    if (req.checkFrequencyMinutes !== undefined) {
      setParts.push(`check_frequency_minutes = $${paramIndex}`);
      values.push(req.checkFrequencyMinutes);
      paramIndex++;
      // Reset schedule: next check = now + new interval
      setParts.push(`check_for_updates_at = NOW() + ($${paramIndex} || ' minutes')::interval`);
      values.push(req.checkFrequencyMinutes);
      paramIndex++;
    }
    if (req.versionPattern !== undefined) {
      setParts.push(`version_pattern = $${paramIndex}`);
      values.push(req.versionPattern);
      paramIndex++;
    }
    if (req.majorVersionFilter !== undefined) {
      setParts.push(`major_version_filter = $${paramIndex}`);
      values.push(req.majorVersionFilter);
      paramIndex++;
    }
    if (req.packageNameTemplate !== undefined) {
      setParts.push(`package_name_template = $${paramIndex}`);
      values.push(req.packageNameTemplate);
      paramIndex++;
    }
    if (req.dryRunMode !== undefined) {
      setParts.push(`dry_run_mode = $${paramIndex}`);
      values.push(req.dryRunMode);
      paramIndex++;
    }
    if (req.minVersion !== undefined) {
      setParts.push(`min_version = $${paramIndex}`);
      values.push(req.minVersion);
      paramIndex++;
    }
    if (req.notifyOnDetection !== undefined) {
      setParts.push(`notify_on_detection = $${paramIndex}`);
      values.push(req.notifyOnDetection);
      paramIndex++;
    }
    if (req.notifyOnBuildFailure !== undefined) {
      setParts.push(`notify_on_build_failure = $${paramIndex}`);
      values.push(req.notifyOnBuildFailure);
      paramIndex++;
    }
    if (req.imageTagTemplate !== undefined) {
      setParts.push(`image_tag_template = $${paramIndex}`);
      values.push(req.imageTagTemplate || null);
      paramIndex++;
    }
    
    if (setParts.length === 1) {
      // Only updated_at, nothing to change
      return await getPackageFamily(id);
    }
    
    const query = `UPDATE package_family SET ${setParts.join(', ')} WHERE id = $${paramIndex}`;
    values.push(id);
    
    await client.query(query, values);
    
    return await getPackageFamily(id);
  } finally {
    client.release();
  }
}

export async function deletePackageFamily(id: string): Promise<boolean> {
  const pool = getDB(process.env.DB_URI!);
  const client = await pool.connect();
  
  try {
    // Delete the package family
    // Note: No need to delete from package_family_package as packages are now dynamically discovered
    const result = await client.query('DELETE FROM package_family WHERE id = $1', [id]);

    return (result.rowCount || 0) > 0;
  } finally {
    client.release();
  }
}

// Note: linkPackageToFamily and unlinkPackageFromFamily functions removed
// Packages are now dynamically discovered based on naming pattern

export async function triggerPackageFamilyUpdateCheck(packageFamilyId: string): Promise<boolean> {
  const pool = getDB(process.env.DB_URI!);
  const client = await pool.connect();

  try {
    // Get all packages that belong to this family via dynamic discovery
    const familyPackages = await getPackageFamilyPackages(packageFamilyId);

    if (familyPackages.length === 0) {
      // No packages found for this family
      return false;
    }

    // Update check_for_updates_at to now for all packages in this family
    const packageIds = familyPackages.map(pkg => pkg.packageId);
    const placeholders = packageIds.map((_, index) => `$${index + 1}`).join(', ');

    const updateQuery = `
      UPDATE package
      SET check_for_updates_at = NOW()
      WHERE id IN (${placeholders})`;

    const updateResult = await client.query(updateQuery, packageIds);

    return (updateResult.rowCount || 0) > 0;
  } finally {
    client.release();
  }
}

export interface UpstreamConfig {
  upstreamType: 'github' | 'release-monitor';
  upstreamIdentifier: string;
  useTags?: boolean; // Only applicable for GitHub
}

export async function getUpstreamConfigFromPackage(packageId: string): Promise<UpstreamConfig | null> {
  const pool = getDB(process.env.DB_URI!);
  const client = await pool.connect();

  try {
    // Get the latest package version's melange YAML
    const query = `
      SELECT pv.melange_yaml
      FROM package_version pv
      WHERE pv.package_id = $1
      ORDER BY pv.apk_release DESC
      LIMIT 1
    `;

    const result = await client.query(query, [packageId]);
    if (result.rows.length === 0) {
      return null;
    }

    const melangeYaml = result.rows[0].melange_yaml;

    // Parse the YAML to extract upstream configuration
    return parseMelangeYamlForUpstreamConfig(melangeYaml);
  } finally {
    client.release();
  }
}

function parseMelangeYamlForUpstreamConfig(melangeYaml: string): UpstreamConfig | null {
  try {
    const parsed = yaml.load(melangeYaml) as any;

    if (!parsed?.update) {
      return null;
    }

    // Check for GitHub monitor
    if (parsed.update.github) {
      const github = parsed.update.github;
      const identifier = github.identifier;
      const useTags = github['use-tag'] !== false; // default to true

      if (!identifier) {
        return null;
      }

      return {
        upstreamType: 'github',
        upstreamIdentifier: identifier,
        useTags,
      };
    }

    // Check for release-monitor
    if (parsed.update['release-monitor']) {
      const releaseMonitor = parsed.update['release-monitor'];
      const identifier = releaseMonitor.identifier;

      if (!identifier) {
        return null;
      }

      return {
        upstreamType: 'release-monitor',
        upstreamIdentifier: String(identifier), // Can be a number or string
      };
    }

    return null;
  } catch (error) {
    console.error('Failed to parse melange YAML:', error);
    return null;
  }
}

export async function getUpstreamConfigFromLatestPackage(packageFamilyId: string): Promise<UpstreamConfig | null> {
  const pool = getDB(process.env.DB_URI!);
  const client = await pool.connect();

  try {
    // Get the package family to access its name and template
    const packageFamily = await getPackageFamily(packageFamilyId);
    if (!packageFamily) {
      return null;
    }

    // Get packages for this family
    const familyPackages = await getPackageFamilyPackages(packageFamilyId);
    if (familyPackages.length === 0) {
      return null;
    }

    // Use the first package (highest version) to get the upstream config
    const latestPackage = familyPackages[0];

    return await getUpstreamConfigFromPackage(latestPackage.packageId);
  } finally {
    client.release();
  }
}