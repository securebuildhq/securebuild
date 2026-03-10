import { getDB } from "../data/db";
import { getParam } from "../data/param";

export interface PackageVersion {
  version: string;
  architecture: string;
  filename: string;
}

export async function getPackageVersions(packageName: string): Promise<PackageVersion[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Query the apk_catalog table to find all versions of the package
    const query = `
      SELECT
        (index_content::jsonb ->> 'V') as version,
        arch as architecture,
        filename
      FROM apk_catalog
      WHERE (index_content::jsonb ->> 'P') = $1
      AND is_withdrawn = false
      AND arch IN ('x86_64', 'aarch64')
      ORDER BY arch, version DESC
    `;

    const result = await db.query(query, [packageName]);

    const versions: PackageVersion[] = result.rows.map(row => ({
      version: row.version || 'unknown',
      architecture: row.architecture,
      filename: row.filename
    }));

    return versions;
  } catch (error) {
    console.error('Error querying package versions:', error);
    throw error;
  }
}

export async function isPackageAvailable(packageName: string): Promise<boolean> {
  try {
    const versions = await getPackageVersions(packageName);
    return versions.length > 0;
  } catch (error) {
    console.error('Error checking package availability:', error);
    return false;
  }
}

export async function getPackageVersionsWithFuzzyMatch(packageName: string): Promise<PackageVersion[]> {
  try {
    // First try exact match
    let versions = await getPackageVersions(packageName);
    if (versions.length > 0) {
      return versions;
    }

    // Try fuzzy matching with common package name variations
    const variations = generatePackageNameVariations(packageName);

    for (const variation of variations) {
      versions = await getPackageVersions(variation);
      if (versions.length > 0) {
        return versions;
      }
    }

    return [];
  } catch (error) {
    console.error('Error in fuzzy package search:', error);
    return [];
  }
}

function generatePackageNameVariations(name: string): string[] {
  const variations = [name];

  // Common transformations
  if (name.includes('_')) {
    variations.push(name.replace(/_/g, '-'));
  }
  if (name.includes('-')) {
    variations.push(name.replace(/-/g, '_'));
  }

  // Remove common prefixes/suffixes
  const prefixes = ['lib', 'python3-', 'py3-', 'node-', 'go-'];
  const suffixes = ['-dev', '-devel', '-headers', '-static', '-doc', '-docs'];

  for (const prefix of prefixes) {
    if (name.startsWith(prefix)) {
      variations.push(name.slice(prefix.length));
    }
  }

  for (const suffix of suffixes) {
    if (name.endsWith(suffix)) {
      variations.push(name.slice(0, -suffix.length));
    }
  }

  // Add common package name mappings
  const mappings: { [key: string]: string[] } = {
    'glibc': ['musl', 'libc-utils'],
    'libc6': ['musl', 'libc-utils'],
    'libssl1.1': ['libssl3', 'openssl'],
    'libssl3': ['openssl'],
    'zlib1g': ['zlib'],
    'libcurl4': ['curl', 'libcurl'],
  };

  if (mappings[name]) {
    variations.push(...mappings[name]);
  }

  // Remove duplicates
  return [...new Set(variations)];
}
