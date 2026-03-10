interface ImageSearchTerms {
  registry: string;
  image: string;
  tag: string;
  digest?: string;
}

// Check if the first part of a path looks like a registry (has a dot or colon)
function looksLikeRegistry(part: string): boolean {
  return part.includes('.') || part.includes(':');
}

/**
 * Parse image reference for search purposes (no normalization or prefixes).
 * Unlike parseImageRef, this function:
 * - Does NOT add library/ prefix for Docker Hub images
 * - Does NOT normalize docker.io to index.docker.io
 * - Returns empty strings instead of defaults (for fuzzy search)
 * - Suitable for ILIKE queries with % wildcards
 */
export function parseImageSearchTerms(searchInput: string): ImageSearchTerms {
  let registry = '';
  let image = '';
  let tag = '';
  let digest: string | undefined;

  if (!searchInput.trim()) {
    return { registry, image, tag };
  }

  // Handle digest search (sha256:...)
  if (searchInput.startsWith('sha256:')) {
    return { registry: '', image: '', tag: '', digest: searchInput };
  }

  let remaining = searchInput;

  // Handle content digest (@sha256:...) if present
  if (remaining.includes('@')) {
    const atIndex = remaining.indexOf('@');
    digest = remaining.substring(atIndex + 1);
    remaining = remaining.substring(0, atIndex);
  }

  // Extract tag if present (last colon after last slash)
  const lastSlashIdx = remaining.lastIndexOf('/');
  const lastColonIdx = remaining.lastIndexOf(':');

  if (lastColonIdx > lastSlashIdx) {
    const afterColon = remaining.substring(lastColonIdx + 1);
    // If afterColon doesn't contain a slash, it's a tag (not a port in registry:port/repo)
    if (!afterColon.includes('/')) {
      tag = afterColon;
      remaining = remaining.substring(0, lastColonIdx);
    }
  }

  // Extract registry if present (first segment that looks like a registry)
  const firstSlashIdx = remaining.indexOf('/');
  if (firstSlashIdx !== -1) {
    const potentialRegistry = remaining.substring(0, firstSlashIdx);
    // Check if it looks like a registry (has dot or colon for port)
    if (looksLikeRegistry(potentialRegistry)) {
      registry = potentialRegistry;
      image = remaining.substring(firstSlashIdx + 1);
    } else {
      // No registry, entire string is the image
      image = remaining;
    }
  } else {
    // No slashes, entire string is the image
    image = remaining;
  }

  return { registry, image, tag, digest };
}
