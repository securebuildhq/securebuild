import * as yaml from "js-yaml";
import { ValidationError } from '@/lib/errors/validation-error';

/**
 * Extract the pipeline name from YAML content
 * @param yamlContent The pipeline YAML content
 * @returns The extracted name or null if not found
 */
export function extractPipelineNameFromYAML(yamlContent: string): string | null {
  try {
    const doc = yaml.load(yamlContent) as any;

    if (!doc || typeof doc !== 'object') {
      return null;
    }

    // Pipeline YAML should have a top-level 'name' field
    if (doc.name && typeof doc.name === 'string') {
      return doc.name;
    }

    return null;
  } catch (error) {
    // Invalid YAML or parsing error
    return null;
  }
}

/**
 * Sanitizes a pipeline path by removing potentially dangerous characters
 * and validating the format. Allows alphanumeric characters, hyphens, 
 * underscores, and forward slashes.
 * 
 * @param path - The pipeline path to sanitize
 * @returns The sanitized path, or null if the path is invalid
 */
export function sanitizePipelinePath(path: string): string | null {
  // Remove leading/trailing whitespace
  const trimmed = path.trim();

  // Check for empty path
  if (!trimmed) {
    return null;
  }

  // Allow only alphanumeric characters, hyphens, underscores, and forward slashes
  // This prevents injection attacks with characters like semicolons, pipes, etc.
  const validPathRegex = /^[a-zA-Z0-9_\-\/]+$/;
  if (!validPathRegex.test(trimmed)) {
    return null;
  }

  // Prevent paths that start or end with slash (should be relative paths)
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) {
    return null;
  }

  // Prevent double slashes and empty segments
  const segments = trimmed.split('/');
  if (segments.some(segment => !segment.trim())) {
    return null;
  }

  return trimmed;
}

/**
 * Validates a pipeline path and throws a ValidationError if invalid.
 *
 * @param path - The pipeline path to validate
 * @returns The sanitized path
 * @throws ValidationError if the path is invalid
 */
export function validatePipelinePath(path: string): string {
  const sanitizedPath = sanitizePipelinePath(path);
  if (!sanitizedPath) {
    throw new ValidationError(
      'Invalid path: Path contains invalid characters or format. Use alphanumeric characters, hyphens, underscores, and forward slashes only.'
    );
  }
  return sanitizedPath;
}

/**
 * Validates a pipeline input name to ensure it can be safely used in ${{inputs.name}} syntax.
 * Valid names must:
 * - Start with a letter (a-z, A-Z)
 * - Contain only letters, numbers, and underscores (no hyphens - Go templates don't support them)
 * - Not be empty
 *
 * @param name - The input name to validate
 * @returns True if valid, false otherwise
 */
export function isValidInputName(name: string): boolean {
  if (!name) {
    return false;
  }

  // Check first character is a letter
  const firstChar = name.charAt(0);
  if (!/[a-zA-Z]/.test(firstChar)) {
    return false;
  }

  // Check all characters are valid (letters, numbers, underscores only - no hyphens)
  // Go's text/template treats hyphens as subtraction operators
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Validates all input names in a pipeline YAML content.
 *
 * @param yamlContent - The pipeline YAML content to validate
 * @throws ValidationError if any input name is invalid
 */
export function validatePipelineInputNames(yamlContent: string): void {
  try {
    const doc = yaml.load(yamlContent) as any;

    if (!doc || typeof doc !== 'object') {
      return;
    }

    // Check if pipeline has inputs defined
    if (doc.inputs && typeof doc.inputs === 'object') {
      const invalidInputs: string[] = [];

      for (const inputName of Object.keys(doc.inputs)) {
        if (!isValidInputName(inputName)) {
          invalidInputs.push(inputName);
        }
      }

      if (invalidInputs.length > 0) {
        throw new ValidationError(
          `Invalid input name(s): ${invalidInputs.join(', ')}. Input names must start with a letter and contain only letters, numbers, and underscores (no hyphens).`
        );
      }
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    // If YAML parsing fails, let the backend handle it
    return;
  }
}
