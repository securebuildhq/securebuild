import { getDB } from "../data/db";
import { getParam } from "../data/param";
import * as srs from "secure-random-string";
import * as yaml from 'yaml';
import semver from 'semver';

/**
 * Version change types for determining package/version/epoch behavior
 */
export enum VersionChangeType {
  SAME = 'same',           // Same version - increment epoch
  PATCH = 'patch',         // Patch version change - same package, reset epoch
  MINOR_OR_MAJOR = 'minor_or_major'  // Minor/major change - new package, reset epoch
}

/**
 * Type definitions
 */
export interface PackageVersion {
  id: string;
  version: string;
  melangeYaml: string;
  apkRelease: number;
  useRoot: boolean;
}

export interface Package {
  id: string;
  name: string;
}

export interface PackageInfo {
  packageId: string;
  packageName: string;
  originalPackageName: string; // Original package name from APKO (e.g., kotsadm-1.127)
  latestPackageVersion: PackageVersion | null;
}

export interface ImageAPKOData {
  imageId: string;
  apkoId: string;
  apkoYaml: string;
  tags: string[];
}

export interface FindPackagesResult {
  packages: PackageInfo[];
  apkoData: ImageAPKOData;
}

/**
 * Find standard package by name
 */
export async function findPackageByName(
  packageName: string
): Promise<Package | null> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    SELECT id, name
    FROM package
    WHERE name = $1
  `;

  const result = await db.query(query, [packageName]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name
  } as Package;
}

/**
 * Get latest package version for a package
 */
export async function getLatestPackageVersion(
  packageId: string
): Promise<PackageVersion | null> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    SELECT id, version, melange_yaml, apk_release, use_root
    FROM package_version
    WHERE package_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const result = await db.query(query, [packageId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    version: row.version,
    melangeYaml: row.melange_yaml,
    apkRelease: row.apk_release,
    useRoot: row.use_root
  } as PackageVersion;
}

/**
 * Get the next available apk_release for a package+version combination
 * Uses MAX(apk_release) + 1 to find the next available release number
 */
export async function getNextApkRelease(
  packageId: string,
  version: string
): Promise<number> {
  const db = getDB(await getParam("DB_URI"));

  const query = `
    SELECT COALESCE(MAX(apk_release), -1) + 1 as next_release
    FROM package_version
    WHERE package_id = $1 AND version = $2
  `;

  const result = await db.query(query, [packageId, version]);
  return result.rows[0].next_release;
}

/**
 * Create a new package version with custom_build_request_id
 * Handles uniqueness constraint by retrying with incremented apk_release on conflicts
 */
export async function createPackageVersionForCustomBuild(
  packageId: string,
  version: string,
  melangeYaml: string,
  customBuildRequestId: string,
  apkRelease: number = 0,
  useRoot: boolean = false
): Promise<string> {
  const db = getDB(await getParam("DB_URI"));
  const maxRetries = 10;
  let currentRelease = apkRelease;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const id = srs.default({ length: 24, alphanumeric: true });

      const query = `
        INSERT INTO package_version
        (id, package_id, version, melange_yaml, apk_release, use_root, custom_build_request_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
      `;

      await db.query(query, [
        id,
        packageId,
        version,
        melangeYaml,
        currentRelease,
        useRoot,
        customBuildRequestId
      ]);

      return id;
    } catch (error: any) {
      // Check if it's a unique constraint violation (PostgreSQL error code 23505)
      if (error.code === '23505' && attempt < maxRetries - 1) {
        // Increment release and retry
        currentRelease++;
        console.log(`Duplicate package version detected, retrying with apk_release=${currentRelease}`);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to create package version after ${maxRetries} attempts`);
}

/**
 * Find image APKO by image name and tag
 * Returns the APKO configuration for the specified image and tag
 *
 * Algorithm:
 * 1. Find image by name
 * 2. Get all image_apko records for this image with their tags
 * 3. Find the tag that is <= requested tag (using semver comparison)
 * 4. Get the latest image_apko_version for that image_apko
 */
export async function findImageAPKOByNameAndTag(
  imageName: string,
  requestedTag: string
): Promise<ImageAPKOData | null> {
  const db = getDB(await getParam("DB_URI"));

  // Step 1: Find all image_apko records with tags for this image
  const apkoQuery = `
    SELECT
      i.id as image_id,
      ia.id as apko_id,
      ia.tags
    FROM image i
    JOIN image_apko ia ON ia.image_id = i.id
    WHERE i.name = $1
  `;

  const apkoResult = await db.query(apkoQuery, [imageName]);

  if (apkoResult.rows.length === 0) {
    return null;
  }

  // Step 2: Find the best matching tag using semver (highest version <= requested)
  let bestMatch: { imageId: string; apkoId: string; tags: string[]; matchedTag: string } | null = null;

  for (const row of apkoResult.rows) {
    const tags: string[] = row.tags;

    for (const tag of tags) {
      // Try to parse both tags with semver, skip if invalid
      const parsedTag = semver.valid(tag) || semver.coerce(tag)?.version;
      const parsedRequested = semver.valid(requestedTag) || semver.coerce(requestedTag)?.version;

      if (!parsedTag || !parsedRequested) {
        // Skip unparseable tags gracefully
        continue;
      }

      // Check if tag <= requestedTag
      if (semver.lte(parsedTag, parsedRequested)) {
        // If no best match yet, or this tag is greater than current best match
        if (!bestMatch || semver.gt(parsedTag, bestMatch.matchedTag)) {
          bestMatch = {
            imageId: row.image_id,
            apkoId: row.apko_id,
            tags: tags,
            matchedTag: parsedTag
          };
        }
      }
    }
  }

  if (!bestMatch) {
    return null;
  }

  // Step 3: Get the latest image_apko_version for the selected image_apko
  const versionQuery = `
    SELECT apko_yaml
    FROM image_apko_version
    WHERE image_apko_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const versionResult = await db.query(versionQuery, [bestMatch.apkoId]);

  if (versionResult.rows.length === 0) {
    return null;
  }

  return {
    imageId: bestMatch.imageId,
    apkoId: bestMatch.apkoId,
    apkoYaml: versionResult.rows[0].apko_yaml,
    tags: bestMatch.tags
  } as ImageAPKOData;
}

/**
 * Create a new image_apko record with a specific tag
 */
export async function createImageAPKO(
  imageId: string,
  tags: string[]
): Promise<string> {
  const db = getDB(await getParam("DB_URI"));
  const id = 'ia' + srs.default({ length: 32, alphanumeric: true });

  // Use first semver-compatible tag as the name for the APKO configuration
  // This avoids using tags like "latest" as the name
  let name = 'APKO';
  for (const tag of tags) {
    const parsed = semver.valid(tag) || semver.coerce(tag)?.version;
    if (parsed) {
      name = tag;
      break;
    }
  }

  const query = `
    INSERT INTO image_apko
    (id, image_id, name, tags, created_at, updated_at)
    VALUES ($1, $2, $3, $4, now(), now())
  `;

  await db.query(query, [
    id,
    imageId,
    name,
    tags
  ]);

  return id;
}

/**
 * Create a new image APKO version with custom_build_request_id
 */
export async function createImageAPKOVersionForCustomBuild(
  imageApkoId: string,
  apkoYaml: string,
  customBuildRequestId: string
): Promise<string> {
  const db = getDB(await getParam("DB_URI"));
  const id = 'av' + srs.default({ length: 32, alphanumeric: true });

  const query = `
    INSERT INTO image_apko_version
    (id, image_apko_id, apko_yaml, custom_build_request_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, now(), now())
  `;

  await db.query(query, [
    id,
    imageApkoId,
    apkoYaml,
    customBuildRequestId
  ]);

  return id;
}

/**
 * Extract package names from APKO YAML, removing version constraints
 * Handles: pkg-1.33~1.33.2, pkg-1.33>1.32, pkg-1.33, pkg
 */
function extractPackageNamesFromApko(apkoYaml: string): string[] {
  try {
    const apkoConfig = yaml.parse(apkoYaml);
    const packages: string[] = apkoConfig?.contents?.packages || [];

    // Extract base package names (remove version constraints)
    // Valid version constraint symbols: =, ~, >, <, >=, <=
    return packages.map(pkg => {
      // Split on version constraint symbols
      const match = pkg.match(/^([a-zA-Z0-9._-]+)/);
      return match ? match[1] : pkg;
    }).filter(Boolean);
  } catch (error) {
    console.error('Failed to parse APKO YAML:', error);
    return [];
  }
}

/**
 * Strip 'v' prefix from version tag if present
 */
function normalizeVersion(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

/**
 * Compare two versions and determine the type of change
 * Returns: SAME, PATCH, or MINOR_OR_MAJOR
 */
export function determineVersionChangeType(
  oldVersion: string,
  newVersion: string
): VersionChangeType {
  const oldNormalized = normalizeVersion(oldVersion);
  const newNormalized = normalizeVersion(newVersion);

  // Parse versions
  const oldParsed = semver.parse(oldNormalized);
  const newParsed = semver.parse(newNormalized);

  if (!oldParsed || !newParsed) {
    throw new Error(`Invalid version format: ${oldVersion} or ${newVersion}`);
  }

  // Check if versions are identical
  if (semver.eq(oldParsed, newParsed)) {
    return VersionChangeType.SAME;
  }

  // Check if only patch version changed
  if (oldParsed.major === newParsed.major && oldParsed.minor === newParsed.minor) {
    return VersionChangeType.PATCH;
  }

  // Minor or major version changed
  return VersionChangeType.MINOR_OR_MAJOR;
}

/**
 * Extract base name from a versioned package name
 * Removes the version suffix (e.g., kubectl-1.33 -> kubectl)
 * Preserves subpackage suffixes (e.g., seaweedfs-3.93-oci-entrypoint -> seaweedfs + -oci-entrypoint)
 * Handles both major.minor (1.33) and major-only (28) versions
 * Examples:
 * - kubectl-1.33 -> kubectl
 * - erlang-28 -> erlang
 * - seaweedfs-3.93 -> seaweedfs
 * - seaweedfs-3.93-oci-entrypoint -> seaweedfs + -oci-entrypoint (split)
 * - scanelf -> scanelf (unchanged)
 */
export function extractBaseName(packageName: string): string {
  // Match version pattern: -\d+\.\d+ (major.minor) or -\d+$ (major only at end)
  // Capture what comes before and after the version
  const match = packageName.match(/^(.+?)-(\d+\.\d+|\d+)(.*)$/);
  if (match) {
    const [, prefix, version, suffix] = match;
    // Only treat as version if it's major.minor OR major-only at the end (no suffix)
    if (version.includes('.') || suffix === '') {
      return prefix + suffix; // Combine prefix and suffix, skipping version
    }
  }
  return packageName; // No version found, return as-is
}

/**
 * Extract version from a versioned package name
 * Returns the version part of a package name, or null if no version found
 * Handles both major.minor (1.33) and major-only (28) versions
 * Examples:
 * - kubectl-1.33 -> "1.33"
 * - erlang-28 -> "28"
 * - seaweedfs-3.93-oci-entrypoint -> "3.93"
 * - scanelf -> null (no version)
 * - ld-linux -> null (hyphens but no version)
 */
export function extractVersion(packageName: string): string | null {
  // Match version pattern: -\d+\.\d+ (major.minor) or -\d+$ (major only at end)
  // Capture what comes before and after the version
  const match = packageName.match(/^(.+?)-(\d+\.\d+|\d+)(.*)$/);
  if (match) {
    const [, prefix, version, suffix] = match;
    // Only treat as version if it's major.minor OR major-only at the end (no suffix)
    if (version.includes('.') || suffix === '') {
      return version;
    }
  }
  return null; // No version found
}

/**
 * Generate package name from base name and version
 * Example: kubectl + 1.33.3 -> kubectl-1.33
 */
function generatePackageName(baseName: string, version: string): string {
  const normalized = normalizeVersion(version);
  // Extract major.minor from version (e.g., 1.33.3 -> 1.33)
  const parts = normalized.split('.');
  if (parts.length >= 2) {
    return `${baseName}-${parts[0]}.${parts[1]}`;
  }
  return baseName;
}

/**
 * Generate new package name from current package name and new version
 * Only replaces version if the current package has a version
 * - If current has major.minor, new gets major.minor
 * - If current has major-only, new gets major-only
 * - If current has no version, returns unchanged
 * Preserves subpackage suffixes in the correct position
 * Examples:
 * - generateNewPackageName('kubectl-1.33', '1.34.0') -> 'kubectl-1.34'
 * - generateNewPackageName('erlang-28', '29.0') -> 'erlang-29'
 * - generateNewPackageName('seaweedfs-3.93-oci-entrypoint', '3.94.1') -> 'seaweedfs-3.94-oci-entrypoint'
 * - generateNewPackageName('scanelf', '1.0.0') -> 'scanelf' (unchanged)
 */
export function generateNewPackageName(currentPackageName: string, newVersion: string): string {
  const normalizedTag = newVersion.startsWith('v') ? newVersion.slice(1) : newVersion;
  const parts = normalizedTag.split('.');

  if (parts.length >= 1) {
    // Match the pattern to identify prefix, old version (major.minor or major-only), and suffix
    const match = currentPackageName.match(/^(.+?)-(\d+\.\d+|\d+)(.*)$/);
    if (match) {
      const [, prefix, oldVersion, suffix] = match;
      // Only treat as version if it's major.minor OR major-only at the end (no suffix)
      if (oldVersion.includes('.') || suffix === '') {
        // Preserve version format: if old was major-only, use major-only; if major.minor, use major.minor
        const newVersionString = oldVersion.includes('.')
          ? (parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0])
          : parts[0]; // Major-only
        return `${prefix}-${newVersionString}${suffix}`;
      }
    }
  }

  // No version found in current name, return unchanged
  return currentPackageName;
}

/**
 * Find the best existing package to use as basis for a new package version
 * Searches for packages with the same base name but different versions,
 * and returns the one with the closest (lower) version to the target version.
 * 
 * Example: For baseName="kotsadm" and targetVersion="1.128.2",
 * finds packages like "kotsadm-1.127", "kotsadm-1.126", etc.
 * and returns the one with the highest version <= targetVersion.
 */
export async function findBestBasisPackage(
  baseName: string,
  targetVersion: string
): Promise<PackageInfo | null> {
  const db = getDB(await getParam("DB_URI"));

  // First, find all packages that match the base name exactly OR start with the base name followed by a dash
  // Group by package to find the max apk_release for each package version
  const query = `
    SELECT p.id, p.name, pv.version, MAX(pv.apk_release) as max_apk_release
    FROM package p
    JOIN package_version pv ON pv.package_id = p.id
    WHERE p.name = $1 OR p.name LIKE $1 || '-%'
    GROUP BY p.id, p.name, pv.version
    ORDER BY p.name DESC
  `;

  const result = await db.query(query, [baseName]);

  if (result.rows.length === 0) {
    return null;
  }

  // Parse the target version for comparison
  const targetParsed = semver.parse(targetVersion) || semver.coerce(targetVersion);
  if (!targetParsed) {
    console.error(`Invalid target version format: ${targetVersion}`);
    return null;
  }

  let bestPackageId: string | null = null;
  let bestPackageName: string | null = null;
  let bestPackageVersion: string | null = null;
  let bestVersion: semver.SemVer | null = null;

  // Find the package with the highest version that's <= target version
  // For unversioned packages, they are always valid as basis packages
  for (const row of result.rows) {
    const packageName = row.name;
    
    // Extract version from package name using the new function
    const packageVersion = extractVersion(packageName);
    
    if (!packageVersion) {
      // This is an unversioned package (e.g., "ld-linux", "scanelf")
      // Unversioned packages are always valid as basis packages
      if (!bestPackageId) {
        bestPackageId = row.id;
        bestPackageName = row.name;
        bestPackageVersion = row.version;
        bestVersion = null; // No version to compare
      }
      continue;
    }

    const parsedVersion = semver.parse(packageVersion) || semver.coerce(packageVersion);
    
    if (!parsedVersion) {
      continue;
    }

    // Check if this version is <= target version and better than current best
    if (semver.lte(parsedVersion, targetParsed)) {
      if (!bestVersion || semver.gt(parsedVersion, bestVersion)) {
        bestVersion = parsedVersion;
        bestPackageId = row.id;
        bestPackageName = row.name;
        bestPackageVersion = row.version;
      }
    }
  }

  if (!bestPackageId || !bestPackageName || !bestPackageVersion) {
    return null;
  }

  // Now load the specific package version with the highest apk_release
  const versionQuery = `
    SELECT id, version, melange_yaml, apk_release, use_root
    FROM package_version
    WHERE package_id = $1 AND version = $2
    ORDER BY apk_release DESC
    LIMIT 1
  `;

  const versionResult = await db.query(versionQuery, [bestPackageId, bestPackageVersion]);

  if (versionResult.rows.length === 0) {
    return null;
  }

  const versionRow = versionResult.rows[0];

  return {
    packageId: bestPackageId,
    packageName: bestPackageName,
    latestPackageVersion: {
      id: versionRow.id,
      version: versionRow.version,
      melangeYaml: versionRow.melange_yaml,
      apkRelease: versionRow.apk_release,
      useRoot: versionRow.use_root
    } as PackageVersion
  } as PackageInfo;
}

/**
 * Find or create a package by name
 */
export async function findOrCreatePackage(
  packageName: string
): Promise<Package> {
  const db = getDB(await getParam("DB_URI"));

  // Try to find existing package
  let query = `
    SELECT id, name
    FROM package
    WHERE name = $1
  `;

  let result = await db.query(query, [packageName]);

  if (result.rows.length > 0) {
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name
    } as Package;
  }

  // Create new package
  const id = srs.default({ length: 24, alphanumeric: true });
  const insertQuery = `
    INSERT INTO package (id, name, created_at, updated_at)
    VALUES ($1, $2, now(), now())
  `;

  await db.query(insertQuery, [id, packageName]);

  return { id, name: packageName } as Package;
}

/**
 * Check if a package name matches the image name pattern
 * Examples:
 * - imageName: kubectl, packageName: kubectl-1.33 → true
 * - imageName: kubectl, packageName: ca-certificates-bundle → false
 * - imageName: seaweedfs, packageName: seaweedfs-3.93 → true
 * - imageName: seaweedfs, packageName: seaweedfs-3.93-oci-entrypoint → true (subpackage)
 * - imageName: seaweedfs, packageName: seaweedfs-oci-entrypoint-3.93 → true (subpackage with version at end)
 */
export function isPackageForImage(imageName: string, packageName: string): boolean {
  // Package must start with the image name followed by dash
  if (!packageName.startsWith(`${imageName}-`)) {
    return false;
  }

  // After image name and dash, we need to find a version pattern somewhere
  // Version pattern: dash followed by digits.digits (e.g., -1.33, -3.93)
  // This handles:
  // 1. kubectl-1.33
  // 2. seaweedfs-3.93-oci-entrypoint
  // 3. seaweedfs-oci-entrypoint-3.93
  // But excludes: ruby-dev-tools (no version pattern)

  const versionPattern = /-(\d+\.\d+)/;
  return versionPattern.test(packageName);
}

/**
 * Find packages for a given image by analyzing the APKO configuration
 * Returns package information needed for custom builds, or null if not found
 * Only returns packages that match the image name (not all packages in APKO)
 * 
 * For new package versions, finds the existing package with the closest version
 * to use as a basis for creating the new package version.
 */
export async function findPackagesForImage(
  imageName: string,
  requestedTag: string
): Promise<FindPackagesResult | null> {
  try {
    // Get the APKO for this image and tag
    const apkoData = await findImageAPKOByNameAndTag(imageName, requestedTag);
    if (!apkoData) {
      return null;
    }

    // Extract ALL package names from APKO YAML
    const allPackageNames = extractPackageNamesFromApko(apkoData.apkoYaml);
    if (allPackageNames.length === 0) {
      return null;
    }

    // Filter to only packages that match the image name
    const relevantPackageNames = allPackageNames.filter(pkgName =>
      isPackageForImage(imageName, pkgName)
    );

    if (relevantPackageNames.length === 0) {
      return null;
    }

    const normalizedVersion = normalizeVersion(requestedTag);
    const packages: PackageInfo[] = [];

    // For each relevant package name, find the best existing package to use as basis
    for (const extractedName of relevantPackageNames) {
      // The extracted name already has a version (e.g., kubectl-1.33)
      // We need to strip the version to get the base name, then regenerate with new version
      const baseName = extractBaseName(extractedName);
      const targetPackageName = generatePackageName(baseName, normalizedVersion);

      // Find the best existing package to use as basis for the new package version
      const basisPackage = await findBestBasisPackage(baseName, normalizedVersion);
      
      if (!basisPackage) {
        console.error(`No basis package found for ${baseName} with version ${normalizedVersion}`);
        return null;
      }

      // Create or find the target package
      const targetPackage = await findOrCreatePackage(targetPackageName);

      packages.push({
        packageId: targetPackage.id,
        packageName: targetPackage.name,
        originalPackageName: extractedName, // Original name from APKO (e.g., kotsadm-1.127)
        latestPackageVersion: basisPackage.latestPackageVersion
      } as PackageInfo);
    }

    return { packages, apkoData } as FindPackagesResult;
  } catch (error) {
    console.error('Error finding packages for image:', error);
    return null;
  }
}
