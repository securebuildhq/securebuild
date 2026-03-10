import * as yaml from 'js-yaml';

/**
 * Update package name, version, epoch, and git-related fields in melange YAML
 * Uses line-by-line replacement to preserve original formatting, comments, and key ordering
 *
 * Updates:
 * 1. package.name, package.version, package.epoch
 * 2. vars.git_commit (if it exists and is a SHA)
 * 3. git-checkout.expected-commit (if it exists and is a SHA, not a variable reference)
 * 4. git-checkout.tag (if it exists and is semver, not a variable reference)
 */
export function updateMelangeVersion(
  melangeYaml: string,
  newPackageName: string,
  newVersion: string,
  newEpoch: number,
  commitSha: string
): string {
  try {
    // Validate YAML structure first
    const doc = yaml.load(melangeYaml) as any;

    if (!doc || typeof doc !== 'object') {
      throw new Error('Invalid melange YAML structure');
    }

    if (!doc.package || typeof doc.package !== 'object') {
      throw new Error('Missing package section in melange YAML');
    }

    // Use line-by-line replacement to preserve formatting
    const lines = melangeYaml.split('\n');
    let inPackageSection = false;
    let inVarsSection = false;
    let nameUpdated = false;
    let versionUpdated = false;
    let epochUpdated = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Track when we enter sections
      if (trimmed === 'package:') {
        inPackageSection = true;
        inVarsSection = false;
        continue;
      } else if (trimmed === 'vars:') {
        inVarsSection = true;
        inPackageSection = false;
        continue;
      }

      // Exit sections when we hit a top-level key
      if ((inPackageSection || inVarsSection) && line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
        inPackageSection = false;
        inVarsSection = false;
      }

      const leadingWhitespace = line.substring(0, line.length - trimmed.length);

      // Update package section fields
      if (inPackageSection) {
        if (trimmed.startsWith('name:') && !nameUpdated) {
          lines[i] = `${leadingWhitespace}name: ${newPackageName}`;
          nameUpdated = true;
        } else if (trimmed.startsWith('version:') && !versionUpdated) {
          lines[i] = `${leadingWhitespace}version: ${newVersion}`;
          versionUpdated = true;
        } else if (trimmed.startsWith('epoch:') && !epochUpdated) {
          lines[i] = `${leadingWhitespace}epoch: ${newEpoch}`;
          epochUpdated = true;
        }
      }

      // Update vars.git_commit if it exists and looks like a SHA (40 hex chars)
      if (inVarsSection && trimmed.startsWith('git_commit:')) {
        const match = trimmed.match(/git_commit:\s*([a-f0-9]{40})/);
        if (match) {
          lines[i] = `${leadingWhitespace}git_commit: ${commitSha}`;
        }
      }
    }

    if (!epochUpdated) {
      throw new Error('epoch field not found in melange YAML');
    }

    let updatedYaml = lines.join('\n');

    // Update git-checkout blocks
    // Pattern: matches "uses: git-checkout" followed by "with:" section
    updatedYaml = updatedYaml.replace(
      /(uses:\s*git-checkout\s*\n(?:\s*#[^\n]*\n)*\s*with:\s*\n(?:(?:\s+[^\n]+\n)*))/g,
      (match) => {
        let block = match;

        // Update expected-commit if it exists and is a SHA (not a variable reference like ${{vars.git_commit}})
        const expectedCommitMatch = block.match(/expected-commit:\s*([a-f0-9]{40})/);
        if (expectedCommitMatch) {
          block = block.replace(
            /^(\s*expected-commit:\s*)([a-f0-9]{40})(\s*)$/m,
            `$1${commitSha}$3`
          );
        }

        // Update tag if it exists and looks like semver (not a variable reference like v${{package.version}})
        const tagMatch = block.match(/tag:\s*v?(\d+\.\d+\.\d+)/);
        if (tagMatch) {
          block = block.replace(
            /^(\s*tag:\s*)(v?)(\d+\.\d+\.\d+)(\s*)$/m,
            `$1$2${newVersion}$4`
          );
        }

        return block;
      }
    );

    // Validate the updated YAML can be parsed
    const updatedDoc = yaml.load(updatedYaml);
    if (!updatedDoc) {
      throw new Error('Failed to generate valid YAML after updates');
    }

    return updatedYaml;
  } catch (error) {
    throw new Error(`Failed to update melange version: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Update package version pins in APKO YAML for custom builds
 * Updates:
 * 1. Package version pins in contents.packages (e.g., ruby-3.4~3.4.6 → ruby-3.4~3.4.7)
 * 2. Package names for minor/major version changes (e.g., ruby-3.4~3.4.6 → ruby-3.5~3.5.2)
 * 3. Environment variables containing version numbers
 * 4. Annotations containing version numbers
 * Uses line-by-line replacement to preserve original formatting, comments, and key ordering
 */
export function updateAPKOForCustomBuild(
  apkoYaml: string,
  oldPackageNames: string[],
  newPackageNames: string[],
  newVersion: string
): string {
  try {
    // Validate YAML structure first
    const doc = yaml.load(apkoYaml) as any;

    if (!doc || typeof doc !== 'object') {
      throw new Error('Invalid APKO YAML structure');
    }

    const normalizedVersion = newVersion.startsWith('v') ? newVersion.slice(1) : newVersion;
    let updatedYaml = apkoYaml;

    // Build a mapping of old package name → new package name
    const packageNameMap = new Map<string, string>();
    for (let i = 0; i < oldPackageNames.length; i++) {
      packageNameMap.set(oldPackageNames[i], newPackageNames[i]);
    }

    // Update package lines in contents.packages section
    // Pattern matches lines like: "    - ruby-3.4~3.4.6" or "    - ruby-3.4=3.4.6"
    // Always uses tilde (~) for version pinning
    updatedYaml = updatedYaml.replace(
      /^(\s+- )([a-zA-Z0-9._-]+)([~>=<]+)([0-9.]+)(.*)$/gm,
      (match, indent, pkgName, operator, version, rest) => {
        // Check if this package name needs to be updated
        const newPkgName = packageNameMap.get(pkgName) || pkgName;

        // Always use tilde (~) for version pinning and update to new version
        return `${indent}${newPkgName}~${normalizedVersion}${rest}`;
      }
    );

    // Update environment variables that contain version numbers
    // Pattern: "  SOME_VERSION: 3.4.6" or "  VERSION: 3.4.6"
    updatedYaml = updatedYaml.replace(
      /^(\s+[A-Z_]+VERSION:\s+)([0-9.]+)(.*)$/gm,
      `$1${normalizedVersion}$3`
    );

    // Update version numbers in annotations
    // Pattern: org.opencontainers.image.title: "App 3.4 (3.4.6)"
    // Need to update both major.minor and full version
    const parts = normalizedVersion.split('.');
    const majorMinor = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : normalizedVersion;

    updatedYaml = updatedYaml.replace(
      /^(\s+org\.opencontainers\.image\.\w+:\s+")([^"]*?)(\d+\.\d+)(\s*\()(\d+\.\d+\.\d+)(\)[^"]*)(")/gm,
      (match, prefix, beforeVersion, oldMajorMinor, parenOpen, oldFullVersion, afterVersion, suffix) => {
        return `${prefix}${beforeVersion}${majorMinor}${parenOpen}${normalizedVersion}${afterVersion}${suffix}`;
      }
    );

    // Simple string replacement: replace 1.127.1 with the new version
    updatedYaml = updatedYaml.replace(/1\.127\.1/g, normalizedVersion);

    // Validate the updated YAML can be parsed
    const updatedDoc = yaml.load(updatedYaml);
    if (!updatedDoc) {
      throw new Error('Failed to generate valid YAML after updates');
    }

    return updatedYaml;
  } catch (error) {
    throw new Error(`Failed to update APKO YAML: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract package name from melange YAML
 */
export function extractPackageNameFromMelange(melangeYaml: string): string {
  try {
    const doc = yaml.load(melangeYaml) as any;

    if (!doc || typeof doc !== 'object') {
      throw new Error('Invalid melange YAML structure');
    }

    if (!doc.package || typeof doc.package !== 'object') {
      throw new Error('Missing package section in melange YAML');
    }

    if (!doc.package.name || typeof doc.package.name !== 'string') {
      throw new Error('Missing or invalid package name in melange YAML');
    }

    return doc.package.name;
  } catch (error) {
    throw new Error(`Failed to extract package name: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract version from melange YAML
 */
export function extractVersionFromMelange(melangeYaml: string): string {
  try {
    const doc = yaml.load(melangeYaml) as any;

    if (!doc || typeof doc !== 'object') {
      throw new Error('Invalid melange YAML structure');
    }

    if (!doc.package || typeof doc.package !== 'object') {
      throw new Error('Missing package section in melange YAML');
    }

    if (!doc.package.version) {
      throw new Error('Missing version in melange YAML');
    }

    // Convert to string to handle numeric versions
    return String(doc.package.version);
  } catch (error) {
    throw new Error(`Failed to extract version: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate that melange YAML has git-checkout with expected-commit
 */
export function validateMelangeForCustomBuild(melangeYaml: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  try {
    const doc = yaml.load(melangeYaml) as any;

    if (!doc || typeof doc !== 'object') {
      errors.push('Invalid melange YAML structure');
      return { valid: false, errors };
    }

    if (!doc.package || typeof doc.package !== 'object') {
      errors.push('Missing package section');
      return { valid: false, errors };
    }

    if (!doc.package.name) {
      errors.push('Missing package name');
    }

    if (!doc.package.version) {
      errors.push('Missing package version');
    }

    // Check for git-checkout in pipeline
    if (!doc.pipeline || !Array.isArray(doc.pipeline)) {
      errors.push('Missing or invalid pipeline section');
      return { valid: false, errors };
    }

    let hasGitCheckout = false;
    for (const step of doc.pipeline) {
      if (step.uses === 'git-checkout') {
        hasGitCheckout = true;
        if (!step.with || typeof step.with !== 'object') {
          errors.push('git-checkout step missing "with" section');
        } else {
          // For custom builds, we expect repository to be set
          if (!step.with.repository) {
            errors.push('git-checkout step missing repository');
          }
          // expected-commit will be set by updateMelangeVersion
        }
      }
    }

    if (!hasGitCheckout) {
      errors.push('Pipeline must contain at least one git-checkout step');
    }

  } catch (error) {
    errors.push(`YAML parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
