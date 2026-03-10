import * as yaml from 'js-yaml';
import { gunzipSync } from 'zlib';
import { ProcessedMelange } from "../types/custom-package";
import { extractAllPackageNames, validatePackageNameFormat } from "./validation";

/**
 * Decompress and decode base64-encoded gzipped content
 */
export function decompressBase64Content(base64Content: string): string {
  try {
    // Decode base64
    const compressed = Buffer.from(base64Content, 'base64');
    
    // Decompress gzip
    const decompressed = gunzipSync(compressed);
    
    return decompressed.toString('utf8');
  } catch (error) {
    throw new Error(`Failed to decompress content: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Process vendor-submitted melange YAML configuration
 * This replaces tags with expected-commit and validates the configuration
 */
export function processVendorMelange(melangeYamlContent: string): ProcessedMelange {
  try {
    // Parse YAML
    const config = yaml.load(melangeYamlContent) as any;
    
    if (!config || typeof config !== 'object') {
      throw new Error("Invalid YAML: must be an object");
    }
    
    // Extract package information
    if (!config.package || !config.package.name) {
      throw new Error("Melange configuration must include package.name");
    }
    
    if (!config.package.version) {
      throw new Error("Melange configuration must include package.version");
    }
    
    const packageName = config.package.name;
    const version = config.package.version;
    
    // Validate main package name format
    const nameError = validatePackageNameFormat(packageName);
    if (nameError) {
      throw new Error(`Invalid main package name: ${nameError}`);
    }
    
    // Extract all names (main, subpackages, provides)
    const allNames = extractAllPackageNames(config);
    
    // Validate all extracted names
    for (const name of allNames) {
      const error = validatePackageNameFormat(name);
      if (error) {
        throw new Error(`Invalid package name "${name}": ${error}`);
      }
    }
    
    // Process pipeline to replace tag with expected-commit
    if (config.pipeline && Array.isArray(config.pipeline)) {
      let hasGitCheckout = false;
      
      for (const step of config.pipeline) {
        if (step && typeof step === 'object' && step.uses === 'git-checkout') {
          hasGitCheckout = true;
          
          if (step.with && typeof step.with === 'object') {
            // If tag is present, require expected-commit instead
            if ('tag' in step.with) {
              // Remove tag
              delete step.with.tag;
              
              // Validate that expected-commit exists
              if (!step.with['expected-commit'] || typeof step.with['expected-commit'] !== 'string') {
                throw new Error("When using git-checkout, you must provide 'expected-commit' instead of 'tag' for vendor packages");
              }
            }
            
            // Validate repository is public (basic URL check)
            if (step.with.repository && typeof step.with.repository === 'string') {
              const repoUrl = step.with.repository.toLowerCase();
              if (!repoUrl.startsWith('https://github.com/')) {
                throw new Error("Repository must be a public GitHub HTTPS URL");
              }
            }
          }
        }
      }
      
      if (hasGitCheckout) {
        // Ensure at least one git-checkout step has expected-commit
        const hasValidCheckout = config.pipeline.some((step: any) => 
          step?.uses === 'git-checkout' && 
          step?.with?.['expected-commit']
        );
        
        if (!hasValidCheckout) {
          throw new Error("At least one git-checkout step must include 'expected-commit'");
        }
      }
    }
    
    // Extract subpackage names
    const subpackages: string[] = [];
    if (config.subpackages && Array.isArray(config.subpackages)) {
      for (const subpackage of config.subpackages) {
        if (subpackage && subpackage.name) {
          subpackages.push(subpackage.name);
        }
      }
    }
    
    // Extract provides arrays
    const provides: string[] = [];
    if (config.package.provides && Array.isArray(config.package.provides)) {
      provides.push(...config.package.provides);
    }
    if (config.subpackages && Array.isArray(config.subpackages)) {
      for (const subpackage of config.subpackages) {
        if (subpackage.provides && Array.isArray(subpackage.provides)) {
          provides.push(...subpackage.provides);
        }
      }
    }
    
    // Re-serialize the modified YAML
    const modifiedYaml = yaml.dump(config, {
      indent: 2,
      lineWidth: 120,
      noRefs: true
    });
    
    return {
      yaml: modifiedYaml,
      packageName,
      version,
      allNames,
      subpackages,
      provides
    };
    
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to process melange configuration: ${String(error)}`);
  }
}

/**
 * Validate that all required fields are present in a melange configuration
 */
export function validateMelangeStructure(config: any): string[] {
  const errors: string[] = [];
  
  if (!config || typeof config !== 'object') {
    errors.push("Configuration must be a valid YAML object");
    return errors;
  }
  
  // Validate package section
  if (!config.package) {
    errors.push("Configuration must include a 'package' section");
  } else {
    if (!config.package.name || typeof config.package.name !== 'string') {
      errors.push("package.name is required and must be a string");
    }
    if (!config.package.version || typeof config.package.version !== 'string') {
      errors.push("package.version is required and must be a string");
    }
    if (!config.package.description || typeof config.package.description !== 'string') {
      errors.push("package.description is required and must be a string");
    }
  }
  
  // Validate environment section
  if (!config.environment) {
    errors.push("Configuration must include an 'environment' section");
  } else if (!config.environment.contents) {
    errors.push("environment.contents is required");
  } else if (!config.environment.contents.packages || !Array.isArray(config.environment.contents.packages)) {
    errors.push("environment.contents.packages is required and must be an array");
  }
  
  // Validate pipeline section
  if (!config.pipeline) {
    errors.push("Configuration must include a 'pipeline' section");
  } else if (!Array.isArray(config.pipeline)) {
    errors.push("pipeline must be an array");
  } else if (config.pipeline.length === 0) {
    errors.push("pipeline cannot be empty");
  }
  
  return errors;
}

/**
 * Extract repository URL from git-checkout steps
 */
export function extractRepositoryUrls(config: any): string[] {
  const urls: string[] = [];
  
  if (config.pipeline && Array.isArray(config.pipeline)) {
    for (const step of config.pipeline) {
      if (step && step.uses === 'git-checkout' && step.with?.repository) {
        urls.push(step.with.repository);
      }
    }
  }
  
  return Array.from(new Set(urls)); // Remove duplicates
}