import semver from 'semver';

/**
 * Sorts tags for display with the following priority:
 * 1. "latest" tag always first
 * 2. Semver tags, ordered by component count (fewer first), then by version descending
 *    - e.g., "7" before "7.4" before "7.4.5"
 * 3. Non-semver tags, sorted alphanumerically ascending
 *
 * @param tags - Array of tag strings to sort
 * @returns Sorted array of tags
 */
export function sortTagsForDisplay(tags: string[]): string[] {
  if (!tags || tags.length === 0) return [];

  const latestTags: string[] = [];
  const semverTags: Array<{ tag: string; version: string; componentCount: number }> = [];
  const nonSemverTags: string[] = [];

  // Categorize tags
  tags.forEach(tag => {
    if (tag === 'latest') {
      latestTags.push(tag);
      return;
    }

    // Try to parse as semver
    const version = semver.valid(semver.coerce(tag));
    if (version) {
      // Determine component count by checking what the original tag starts with
      // This handles tags like "1.2-prerelease.1" correctly (2 components, not 3)
      // Strip any leading 'v' or 'V' first
      const cleanTag = tag.startsWith('v') || tag.startsWith('V') ? tag.slice(1) : tag;

      // Parse the coerced version to get major, minor, patch
      const parsed = semver.parse(version);
      if (!parsed) {
        nonSemverTags.push(tag);
        return;
      }

      const { major, minor, patch } = parsed;

      // Check what the original tag starts with to determine component count
      // Must check in order of specificity (3, 2, 1) to avoid false matches
      // Examples:
      //   "7" starts with "7" → 1 component
      //   "7.4" starts with "7.4" → 2 components
      //   "7.4.5" starts with "7.4.5" → 3 components
      //   "7.4.5-prerelease.1" starts with "7.4.5" → 3 components
      //   "7.4-prerelease.1" starts with "7.4" → 2 components
      let componentCount = 3; // default to 3

      if (cleanTag.startsWith(`${major}.${minor}.${patch}`)) {
        componentCount = 3;
      } else if (cleanTag.startsWith(`${major}.${minor}`)) {
        componentCount = 2;
      } else if (cleanTag.startsWith(`${major}`)) {
        componentCount = 1;
      }

      semverTags.push({ tag, version, componentCount });
    } else {
      nonSemverTags.push(tag);
    }
  });

  // Sort semver tags by component count (ascending), then by version (descending)
  semverTags.sort((a, b) => {
    if (a.componentCount !== b.componentCount) {
      return a.componentCount - b.componentCount; // Fewer components first
    }
    return semver.rcompare(a.version, b.version); // Higher version first within same component count
  });

  // Sort non-semver tags alphanumerically (ascending)
  nonSemverTags.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  // Combine: latest, then semver, then non-semver
  return [
    ...latestTags,
    ...semverTags.map(t => t.tag),
    ...nonSemverTags,
  ];
}
