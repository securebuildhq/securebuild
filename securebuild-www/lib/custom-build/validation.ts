/**
 * Validation utilities for custom build API
 */

/**
 * Validate image name format
 */
export function validateImageName(imageName: string): { valid: boolean; error?: string } {
  if (!imageName || typeof imageName !== 'string') {
    return { valid: false, error: 'Image name is required' };
  }

  if (imageName.length === 0) {
    return { valid: false, error: 'Image name cannot be empty' };
  }

  if (imageName.length > 255) {
    return { valid: false, error: 'Image name too long (max 255 characters)' };
  }

  // Allow alphanumeric, hyphens, underscores, and slashes (for namespaced images)
  const namePattern = /^[a-z0-9][a-z0-9._/-]*$/;
  if (!namePattern.test(imageName)) {
    return {
      valid: false,
      error: 'Image name must start with alphanumeric and contain only lowercase letters, numbers, dots, hyphens, underscores, and slashes'
    };
  }

  return { valid: true };
}

/**
 * Validate tag format
 */
export function validateTag(tag: string): { valid: boolean; error?: string } {
  if (!tag || typeof tag !== 'string') {
    return { valid: false, error: 'Tag is required' };
  }

  if (tag.length === 0) {
    return { valid: false, error: 'Tag cannot be empty' };
  }

  if (tag.length > 128) {
    return { valid: false, error: 'Tag too long (max 128 characters)' };
  }

  // Tags should be valid Docker tags (alphanumeric, hyphens, underscores, dots)
  // Cannot start with period or hyphen
  const tagPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
  if (!tagPattern.test(tag)) {
    return {
      valid: false,
      error: 'Tag must start with alphanumeric and contain only letters, numbers, dots, hyphens, and underscores'
    };
  }

  return { valid: true };
}

/**
 * Validate commit SHA format
 */
export function validateCommitSha(commitSha: string): { valid: boolean; error?: string } {
  if (!commitSha || typeof commitSha !== 'string') {
    return { valid: false, error: 'Commit SHA is required' };
  }

  if (commitSha.length === 0) {
    return { valid: false, error: 'Commit SHA cannot be empty' };
  }

  // Git commit SHAs are 40 character hex strings (can be abbreviated to 7+ chars)
  const shaPattern = /^[a-f0-9]{7,40}$/;
  if (!shaPattern.test(commitSha)) {
    return {
      valid: false,
      error: 'Commit SHA must be a valid git SHA (7-40 hexadecimal characters)'
    };
  }

  return { valid: true };
}

/**
 * Validate all build request fields
 */
export function validateBuildRequest(body: {
  image_name?: string;
  tag?: string;
  commit_sha?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate image_name
  if (!body.image_name) {
    errors.push('Missing required field: image_name');
  } else {
    const nameValidation = validateImageName(body.image_name);
    if (!nameValidation.valid && nameValidation.error) {
      errors.push(nameValidation.error);
    }
  }

  // Validate tag
  if (!body.tag) {
    errors.push('Missing required field: tag');
  } else {
    const tagValidation = validateTag(body.tag);
    if (!tagValidation.valid && tagValidation.error) {
      errors.push(tagValidation.error);
    }
  }

  // Validate commit_sha
  if (!body.commit_sha) {
    errors.push('Missing required field: commit_sha');
  } else {
    const shaValidation = validateCommitSha(body.commit_sha);
    if (!shaValidation.valid && shaValidation.error) {
      errors.push(shaValidation.error);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
