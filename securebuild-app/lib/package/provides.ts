import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import srs from 'secure-random-string';
import { PoolClient } from 'pg';
import { executeMelangeCompile } from './melange-executor';
import { getPipelineDirectory } from '@/lib/pipeline/directory';

interface ProvidesEntry {
  packageName: string;
  providesName: string;
  providesSpec: string;
  isSubpackage: boolean;
}

interface MelangePackage {
  name: string;
  dependencies?: {
    provides?: string[];
  };
}

interface MelangeSubpackage {
  name: string;
  dependencies?: {
    provides?: string[];
  };
}

export interface MelangeConfig {
  package: MelangePackage;
  subpackages?: MelangeSubpackage[];
}

/**
 * Compile melange YAML using the melange CLI
 */
export async function compileMelangeYAML(melangeYaml: string): Promise<MelangeConfig> {
  // Create a temporary directory
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'melange-compile-'));

  try {
    // Write melange YAML to temp file
    const melangeYamlPath = path.join(tmpDir, 'melange.yaml');
    await fs.writeFile(melangeYamlPath, melangeYaml, 'utf8');

    // Get the configured pipeline directory for package pipelines
    const pipelineDir = await getPipelineDirectory('package');
    // Verify the directory exists and is accessible
    await fs.access(pipelineDir);

    // Use the executor to run melange compile
    const compiled = await executeMelangeCompile(melangeYamlPath, pipelineDir);
    return compiled;
  } finally {
    // Clean up temp directory
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Parse package name from provides string (e.g., "kotsadm=1.127.1-r7" -> "kotsadm")
 */
function parsePackageName(provides: string): string {
  return provides.match(/^([^@=><~]+)/)?.[1] ?? provides;
}

/**
 * Extract provides entries from compiled melange configuration
 */
function extractProvidesFromConfig(compiled: MelangeConfig): ProvidesEntry[] {
  const entries: ProvidesEntry[] = [];

  // Extract provides from main package
  if (compiled.package.dependencies?.provides) {
    for (const provides of compiled.package.dependencies.provides) {
      const providesName = parsePackageName(provides);
      entries.push({
        packageName: compiled.package.name,
        providesName,
        providesSpec: provides,
        isSubpackage: false,
      });
    }
  }

  // Extract provides from subpackages
  if (compiled.subpackages) {
    for (const subpkg of compiled.subpackages) {
      if (subpkg.dependencies?.provides) {
        for (const provides of subpkg.dependencies.provides) {
          const providesName = parsePackageName(provides);
          entries.push({
            packageName: subpkg.name,
            providesName,
            providesSpec: provides,
            isSubpackage: true,
          });
        }
      }
    }
  }

  return entries;
}

/**
 * Extract provides data from melange YAML
 */
export async function extractProvidesFromMelangeYAML(melangeYaml: string): Promise<ProvidesEntry[]> {
  const compiled = await compileMelangeYAML(melangeYaml);
  return extractProvidesFromConfig(compiled);
}

/**
 * Write package version provides to the database
 */
export async function writePackageVersionProvides(
  client: PoolClient,
  packageVersionId: string,
  melangeYaml: string
): Promise<void> {
  // Delete existing provides records for this package version
  await client.query(
    `DELETE FROM package_version_provides WHERE package_version_id = $1`,
    [packageVersionId]
  );

  try {
    // Extract provides from melange YAML
    const provides = await extractProvidesFromMelangeYAML(melangeYaml);

    if (provides.length === 0) {
      return;
    }

    // Insert new provides records
    for (const entry of provides) {
      const id = srs({ length: 24, alphanumeric: true });
      await client.query(
        `
        INSERT INTO package_version_provides
        (id, package_version_id, package_name, provides_name, provides_spec, is_subpackage)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
        [id, packageVersionId, entry.packageName, entry.providesName, entry.providesSpec, entry.isSubpackage]
      );
    }
  } catch (error) {
    console.error(`Failed to extract or write provides for package version ${packageVersionId}:`, error);
    // Don't throw - provides extraction is optional and shouldn't block the main operation
  }
}
