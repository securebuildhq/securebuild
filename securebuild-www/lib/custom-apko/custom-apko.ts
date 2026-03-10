import { getDB, withTransaction } from "../data/db";
import { getParam } from "../data/param";
import { enqueueWork } from "../utils/queue";
import { APKOConfig, APKOValidationResult, CustomAPKOResponse } from "../types/apko";
import * as srs from "secure-random-string";
import yaml from 'js-yaml';



/**
 * Simple YAML parser for APKO configuration
 * This is a basic implementation that handles our specific APKO structure
 */
export function parseYAMLConfig(yamlString: string): APKOConfig {
  try {
    const parsed = yaml.load(yamlString) as APKOConfig;
    return parsed;
  } catch (error) {
    throw new Error(`Invalid YAML configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validates APKO configuration structure
 */
export function validateAPKOConfig(config: APKOConfig): APKOValidationResult {
  const errors: string[] = [];

  // Check required fields
  if (!config.contents) {
    errors.push("APKO config must include a 'contents' section");
  } else {
    // Validate repositories
    if (!config.contents.repositories || !Array.isArray(config.contents.repositories) || config.contents.repositories.length === 0) {
      errors.push("APKO config must include at least one repository");
    } else {
      // Validate each repository URL
      for (const repo of config.contents.repositories) {
        if (typeof repo !== 'string' || repo.trim().length === 0) {
          errors.push("All repositories must be non-empty strings");
          break;
        }
        // Basic URL validation
        if (!repo.startsWith('http://') && !repo.startsWith('https://')) {
          errors.push(`Repository URL must start with http:// or https://: ${repo}`);
        }
      }
    }

    // Validate keyring
    if (!config.contents.keyring || !Array.isArray(config.contents.keyring) || config.contents.keyring.length === 0) {
      errors.push("APKO config must include at least one keyring");
    } else {
      // Validate each keyring URL
      for (const keyring of config.contents.keyring) {
        if (typeof keyring !== 'string' || keyring.trim().length === 0) {
          errors.push("All keyring entries must be non-empty strings");
          break;
        }
        // Basic URL validation
        if (!keyring.startsWith('http://') && !keyring.startsWith('https://')) {
          errors.push(`Keyring URL must start with http:// or https://: ${keyring}`);
        }
      }
    }

    // Validate packages
    if (!config.contents.packages || !Array.isArray(config.contents.packages) || config.contents.packages.length === 0) {
      errors.push("APKO config must include at least one package");
    } else {
      // Validate each package name
      for (const pkg of config.contents.packages) {
        if (typeof pkg !== 'string' || pkg.trim().length === 0) {
          errors.push("All packages must be non-empty strings");
          break;
        }
        // Basic package name validation (allow alphanumeric, hyphens, dots, underscores)
        if (!/^[a-zA-Z0-9._-]+(@[a-zA-Z0-9._-]+)?$/.test(pkg)) {
          errors.push(`Invalid package name format: ${pkg}`);
        }
      }
    }
  }

  // Validate entrypoint if specified
  if (config.entrypoint) {
    if (typeof config.entrypoint !== 'object' || !config.entrypoint.command) {
      errors.push("Entrypoint must be an object with a 'command' field");
    } else if (typeof config.entrypoint.command !== 'string' || config.entrypoint.command.trim().length === 0) {
      errors.push("Entrypoint command must be a non-empty string");
    }
  }

  // Validate cmd if specified
  if (config.cmd !== undefined && (typeof config.cmd !== 'string' || config.cmd.trim().length === 0)) {
    errors.push("Command (cmd) must be a non-empty string if specified");
  }

  // Validate work-dir if specified
  if (config["work-dir"] !== undefined && (typeof config["work-dir"] !== 'string' || config["work-dir"].trim().length === 0)) {
    errors.push("Work directory (work-dir) must be a non-empty string if specified");
  }

  // Validate environment if specified
  if (config.environment !== undefined) {
    if (typeof config.environment !== 'object' || Array.isArray(config.environment)) {
      errors.push("Environment must be an object with key-value pairs");
    } else {
      for (const [key, value] of Object.entries(config.environment)) {
        if (typeof key !== 'string' || key.trim().length === 0) {
          errors.push("Environment variable names must be non-empty strings");
          break;
        }
        if (typeof value !== 'string') {
          errors.push(`Environment variable values must be strings: ${key}=${value}`);
          break;
        }
      }
    }
  }

  // Validate accounts if specified
  if (config.accounts !== undefined) {
    if (typeof config.accounts !== 'object' || Array.isArray(config.accounts)) {
      errors.push("Accounts must be an object");
    } else if (config.accounts["run-as"] !== undefined) {
      if (typeof config.accounts["run-as"] !== 'string' || config.accounts["run-as"].trim().length === 0) {
        errors.push("Accounts run-as must be a non-empty string if specified");
      }
    }
  }

  // Validate architectures if specified
  if (config.archs !== undefined) {
    if (!Array.isArray(config.archs)) {
      errors.push("Architectures (archs) must be an array");
    } else {
      const supportedArchs = ["x86_64", "aarch64"];
      const unsupportedArchs = config.archs.filter(arch => !supportedArchs.includes(arch));
      if (unsupportedArchs.length > 0) {
        errors.push(`Unsupported architectures: ${unsupportedArchs.join(", ")}. Supported: ${supportedArchs.join(", ")}`);
      }
      // Check for duplicates
      const uniqueArchs = [...new Set(config.archs)];
      if (uniqueArchs.length !== config.archs.length) {
        errors.push("Duplicate architectures are not allowed");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Creates a custom APKO configuration and triggers image build
 */
export async function createCustomAPKO(
  teamId: string,
  name: string,
  tags: string[],
  apkoConfigYAML: string,
  readme?: string,
  registryUrls?: string[]
): Promise<CustomAPKOResponse> {
  try {
    const db = getDB(await getParam("DB_URI"));


    // Parse YAML configuration
    let apkoConfig;
    try {
      apkoConfig = parseYAMLConfig(apkoConfigYAML);
    } catch (error) {
      return {
        success: false,
        error: `Invalid APKO YAML: ${error instanceof Error ? error.message : 'Unknown parsing error'}`
      };
    }

    // Validate APKO configuration
    const validation = validateAPKOConfig(apkoConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid APKO configuration: ${validation.errors.join(", ")}`
      };
    }

    // Store the original YAML string exactly as submitted
    const apkoYaml = apkoConfigYAML;


    let customImageId: string = '';
    let customApkoId: string = '';
    let customApkoVersionId: string = '';

    await withTransaction(db, async (client) => {
      // Create the custom image record
      customImageId = 'ci' + srs.default({ length: 32, alphanumeric: true });
      
      // Use the first tag as default tag, or "latest" if no tags specified
      const defaultTag = tags.length > 0 ? tags[0] : "latest";
      const tagsToUse = tags.length > 0 ? tags : ["latest"];
      
      const imageQuery = `
        INSERT INTO custom_image (id, team_id, name, default_tag, registry_urls, created_at, updated_at, readme) 
        VALUES ($1, $2, $3, $4, $5, now(), now(), $6)
      `;
      await client.query(imageQuery, [
        customImageId, 
        teamId, 
        name, 
        defaultTag, 
        registryUrls || [],
        readme || null
      ]);

      // Create custom APKO configuration record
      customApkoId = 'ca' + srs.default({ length: 32, alphanumeric: true });
      const apkoQuery = `
        INSERT INTO custom_image_apko (id, custom_image_id, name, tags, created_at, updated_at, readme) 
        VALUES ($1, $2, $3, $4, now(), now(), $5)
      `;
      await client.query(apkoQuery, [customApkoId, customImageId, name, tagsToUse, readme || null]);

      // Create custom APKO version record with the YAML configuration
      customApkoVersionId = 'cav' + srs.default({ length: 32, alphanumeric: true });
      const apkoVersionQuery = `
        INSERT INTO custom_image_apko_version (id, custom_image_apko_id, apko_yaml, created_at, updated_at) 
        VALUES ($1, $2, $3, now(), now())
      `;
      await client.query(apkoVersionQuery, [customApkoVersionId, customApkoId, apkoYaml]);

      // Note: Registry credentials validation is skipped during creation
      // Registry credentials should be configured separately using /api/v1/custom-external-registry
      // The build process will validate registry credentials when actually needed
    });

    // Enqueue build work for custom image
    await enqueueWork('build_custom_image', {
      custom_image_apko_version_id: customApkoVersionId,
      team_id: teamId
    });

    return {
      success: true,
      custom_image_id: customImageId,
      custom_apko_id: customApkoId,
      custom_apko_version_id: customApkoVersionId
    };

  } catch (error) {
    console.error('Error creating custom APKO:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Custom image build status constants (matching Go constants)
 */
export const CustomImageBuildStatus = {
  QUEUED: 'queued',
  BUILDING: 'building', 
  COMPLETED: 'completed',
  FAILED: 'failed'
} as const;

export type CustomImageBuildStatusType = typeof CustomImageBuildStatus[keyof typeof CustomImageBuildStatus];

/**
 * Custom image build record interface
 */
export interface CustomImageBuild {
  id: string;
  custom_image_apko_version_id: string;
  team_id: string;
  status: CustomImageBuildStatusType;
  created_at: Date;
  timeout_at?: Date;
  builder_id?: string;
  build_started_at?: Date;
  build_finished_at?: Date;
  apko_stdout?: string;
  apko_stderr?: string;
  grype_aarch64_stderr?: string;
  grype_x86_64_stderr?: string;
  builder_stdout?: string;
  worker_error?: string;
}

/**
 * Get build status for a specific custom image APKO version
 */
export async function getCustomImageBuildStatus(
  customImageApkoVersionId: string, 
  teamId: string
): Promise<CustomImageBuild | null> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Get the latest build for this APKO version
    const query = `
      SELECT 
        cib.id,
        cib.custom_image_apko_version_id,
        cib.team_id,
        cib.status,
        cib.created_at,
        cib.timeout_at,
        cib.builder_id,
        cib.build_started_at,
        cib.build_finished_at,
        cib.apko_stdout,
        cib.apko_stderr,
        cib.grype_aarch64_stderr,
        cib.grype_x86_64_stderr,
        cib.builder_stdout,
        cib.worker_error
      FROM custom_image_build cib
      JOIN custom_image_apko_version ciav ON cib.custom_image_apko_version_id = ciav.id
      JOIN custom_image_apko cia ON ciav.custom_image_apko_id = cia.id
      JOIN custom_image ci ON cia.custom_image_id = ci.id
      WHERE cib.custom_image_apko_version_id = $1 
        AND ci.team_id = $2
      ORDER BY cib.created_at DESC
      LIMIT 1
    `;

    const result = await db.query(query, [customImageApkoVersionId, teamId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    
    return {
      id: row.id,
      custom_image_apko_version_id: row.custom_image_apko_version_id,
      team_id: row.team_id,
      status: row.status as CustomImageBuildStatusType,
      created_at: row.created_at,
      timeout_at: row.timeout_at,
      builder_id: row.builder_id,
      build_started_at: row.build_started_at,
      build_finished_at: row.build_finished_at,
      apko_stdout: row.apko_stdout,
      apko_stderr: row.apko_stderr,
      grype_aarch64_stderr: row.grype_aarch64_stderr,
      grype_x86_64_stderr: row.grype_x86_64_stderr,
      builder_stdout: row.builder_stdout,
      worker_error: row.worker_error
    };

  } catch (error) {
    console.error('Error getting custom image build status:', error);
    throw error;
  }
}

/**
 * List all builds for a custom image with pagination and team filtering
 */
export async function listCustomImageBuilds(
  customImageId: string, 
  teamId: string,
  page: number = 1,
  limit: number = 10
): Promise<{
  builds: CustomImageBuild[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const offset = (page - 1) * limit;

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM custom_image_build cib
      JOIN custom_image_apko_version ciav ON cib.custom_image_apko_version_id = ciav.id
      JOIN custom_image_apko cia ON ciav.custom_image_apko_id = cia.id
      JOIN custom_image ci ON cia.custom_image_id = ci.id
      WHERE ci.id = $1 AND ci.team_id = $2
    `;
    const countResult = await db.query(countQuery, [customImageId, teamId]);
    const total = parseInt(countResult.rows[0]?.total || '0');

    // Get paginated builds with APKO config name for context
    const query = `
      SELECT 
        cib.id,
        cib.custom_image_apko_version_id,
        cib.team_id,
        cib.status,
        cib.created_at,
        cib.timeout_at,
        cib.builder_id,
        cib.build_started_at,
        cib.build_finished_at,
        cib.apko_stdout,
        cib.apko_stderr,
        cib.grype_aarch64_stderr,
        cib.grype_x86_64_stderr,
        cib.builder_stdout,
        cib.worker_error
      FROM custom_image_build cib
      JOIN custom_image_apko_version ciav ON cib.custom_image_apko_version_id = ciav.id
      JOIN custom_image_apko cia ON ciav.custom_image_apko_id = cia.id
      JOIN custom_image ci ON cia.custom_image_id = ci.id
      WHERE ci.id = $1 AND ci.team_id = $2
      ORDER BY cib.created_at DESC
      LIMIT $3 OFFSET $4
    `;
    const result = await db.query(query, [customImageId, teamId, limit, offset]);

    const builds: CustomImageBuild[] = result.rows.map(row => ({
      id: row.id,
      custom_image_apko_version_id: row.custom_image_apko_version_id,
      team_id: row.team_id,
      status: row.status as CustomImageBuildStatusType,
      created_at: row.created_at,
      timeout_at: row.timeout_at,
      builder_id: row.builder_id,
      build_started_at: row.build_started_at,
      build_finished_at: row.build_finished_at,
      apko_stdout: row.apko_stdout,
      apko_stderr: row.apko_stderr,
      grype_aarch64_stderr: row.grype_aarch64_stderr,
      grype_x86_64_stderr: row.grype_x86_64_stderr,
      builder_stdout: row.builder_stdout,
      worker_error: row.worker_error
    }));

    return {
      builds,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  } catch (error) {
    console.error('Error listing custom image builds:', error);
    throw error;
  }
}

/**
 * Get custom APKO configuration by ID
 */
export async function getCustomAPKO(customApkoId: string, teamId: string): Promise<{
  id: string;
  name: string;
  tags: string[];
  config: string;
  readme?: string;
  createdAt: Date;
  updatedAt: Date;
} | null> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Get custom APKO record with latest version, ensuring team access
    const query = `
      SELECT 
        cia.id, 
        cia.name, 
        cia.tags, 
        cia.readme,
        cia.created_at, 
        cia.updated_at,
        ciav.apko_yaml
      FROM custom_image_apko cia
      JOIN custom_image ci ON cia.custom_image_id = ci.id
      LEFT JOIN custom_image_apko_version ciav ON cia.id = ciav.custom_image_apko_id
      WHERE cia.id = $1 AND ci.team_id = $2
      ORDER BY ciav.created_at DESC
      LIMIT 1
    `;

    const result = await db.query(query, [customApkoId, teamId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    
    // Return raw YAML configuration (no parsing needed for retrieval)
    return {
      id: row.id,
      name: row.name,
      tags: row.tags || [],
      config: row.apko_yaml,
      readme: row.readme,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };

  } catch (error) {
    console.error('Error getting custom APKO:', error);
    throw error;
  }
}