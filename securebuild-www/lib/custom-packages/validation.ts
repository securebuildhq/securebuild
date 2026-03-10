import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { PackageConflict } from "../types/custom-package";

/**
 * Check for package name conflicts across all package namespaces
 * This includes checking main packages, subpackages, and provides arrays
 * using LIKE queries to catch version-suffixed names
 */
export async function checkAllNameConflicts(
  packageNames: string[],
  teamId: string
): Promise<PackageConflict[]> {
  if (!packageNames || packageNames.length === 0) {
    return [];
  }

  const db = getDB(await getParam("DB_URI"));
  const conflicts: PackageConflict[] = [];

  // Check against existing packages (main package table)
  for (const name of packageNames) {
    // Check exact match first
    let query = `
      SELECT name, 'n/a' as team_id, 'package' as table_name
      FROM package 
      WHERE name = $1
    `;
    let result = await db.query(query, [name]);
    
    if (result.rows.length > 0) {
      conflicts.push({
        name: result.rows[0].name,
        team_id: result.rows[0].team_id || 'n/a',
        table: 'package'
      });
      continue;
    }

    // Check version-suffixed names using LIKE (e.g., 'foo-1.2.3', 'foo-dev', etc.)
    query = `
      SELECT name, 'n/a' as team_id, 'package' as table_name
      FROM package 
      WHERE name LIKE $1
    `;
    result = await db.query(query, [name + '-%']);
    
    if (result.rows.length > 0) {
      conflicts.push({
        name: result.rows[0].name,
        team_id: result.rows[0].team_id || 'n/a',
        table: 'package'
      });
    }
  }

  // Check against existing custom packages
  for (const name of packageNames) {
    // Check exact match first
    let query = `
      SELECT name, team_id, 'custom_package' as table_name
      FROM custom_package 
      WHERE name = $1 AND team_id != $2
    `;
    let result = await db.query(query, [name, teamId]);
    
    if (result.rows.length > 0) {
      conflicts.push({
        name: result.rows[0].name,
        team_id: result.rows[0].team_id,
        table: 'custom_package'
      });
      continue;
    }

    // Check version-suffixed names using LIKE
    query = `
      SELECT name, team_id, 'custom_package' as table_name
      FROM custom_package 
      WHERE name LIKE $1 AND team_id != $2
    `;
    result = await db.query(query, [name + '-%', teamId]);
    
    if (result.rows.length > 0) {
      conflicts.push({
        name: result.rows[0].name,
        team_id: result.rows[0].team_id,
        table: 'custom_package'
      });
    }
  }

  return conflicts;
}

/**
 * Check if a single package name conflicts with existing packages
 */
export async function checkPackageNameConflict(
  packageName: string,
  teamId: string
): Promise<PackageConflict | null> {
  const conflicts = await checkAllNameConflicts([packageName], teamId);
  return conflicts.length > 0 ? conflicts[0] : null;
}

/**
 * Get all package names that would be created by a melange configuration
 * This includes the main package name, all subpackage names, and all provides entries
 */
export function extractAllPackageNames(melangeConfig: any): string[] {
  const names: string[] = [];
  
  // Extract main package name
  if (melangeConfig.package && melangeConfig.package.name) {
    names.push(melangeConfig.package.name);
  }
  
  // Extract subpackage names
  if (melangeConfig.subpackages && Array.isArray(melangeConfig.subpackages)) {
    for (const subpackage of melangeConfig.subpackages) {
      if (subpackage.name) {
        names.push(subpackage.name);
      }
    }
  }
  
  // Extract provides arrays from main package
  if (melangeConfig.package && melangeConfig.package.provides && Array.isArray(melangeConfig.package.provides)) {
    names.push(...melangeConfig.package.provides);
  }
  
  // Extract provides arrays from subpackages
  if (melangeConfig.subpackages && Array.isArray(melangeConfig.subpackages)) {
    for (const subpackage of melangeConfig.subpackages) {
      if (subpackage.provides && Array.isArray(subpackage.provides)) {
        names.push(...subpackage.provides);
      }
    }
  }
  
  // Remove duplicates and empty strings
  return Array.from(new Set(names.filter(name => name && typeof name === 'string' && name.trim().length > 0)));
}

/**
 * Validate package name format
 * Alpine package names should be lowercase and contain only alphanumeric characters, hyphens, and underscores
 */
export function validatePackageNameFormat(packageName: string): string | null {
  if (!packageName || typeof packageName !== 'string') {
    return "Package name must be a non-empty string";
  }
  
  const trimmed = packageName.trim();
  if (trimmed.length === 0) {
    return "Package name cannot be empty";
  }
  
  if (trimmed.length > 64) {
    return "Package name cannot exceed 64 characters";
  }
  
  // Cannot start or end with special characters
  if (trimmed.startsWith('.') || trimmed.startsWith('-') || trimmed.startsWith('_') ||
      trimmed.endsWith('.') || trimmed.endsWith('-') || trimmed.endsWith('_')) {
    return "Package name cannot start or end with special characters (. - _)";
  }
  
  // Alpine package naming conventions
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(trimmed)) {
    return "Package name must start with alphanumeric character and contain only lowercase letters, numbers, dots, hyphens, and underscores";
  }
  
  return null; // Valid
}