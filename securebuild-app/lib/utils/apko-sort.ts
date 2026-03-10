import semver from 'semver';
import type { ImageAPKO } from '../types/image';

/**
 * Sorts APKOs by their tags using semver-aware sorting.
 *
 * Algorithm:
 * 1. APKOs without tags (or only "latest") appear at the top (newest first)
 * 2. APKOs with tags are sorted by semver (highest version first)
 * 3. If semver parsing fails, use alphanumeric ordering
 *
 * @param apkos - Array of ImageAPKO objects to sort
 * @returns Sorted array of ImageAPKO objects
 */
export function sortAPKOsByVersion(apkos: ImageAPKO[]): ImageAPKO[] {
  // Separate APKOs with and without tags
  const apkosWithoutTags: ImageAPKO[] = [];
  const apkosWithTags: ImageAPKO[] = [];
  const tagToApkoMap = new Map<string, ImageAPKO>();

  apkos.forEach(apko => {
    if (apko.tags && apko.tags.length > 0) {
      // Filter out "latest" to see if there are any real tags
      const nonLatestTags = apko.tags.filter(tag => tag !== 'latest');

      if (nonLatestTags.length === 0) {
        // Only has "latest" tag, treat as untagged
        apkosWithoutTags.push(apko);
      } else {
        // Has real tags
        apkosWithTags.push(apko);
        nonLatestTags.forEach(tag => {
          tagToApkoMap.set(tag, apko);
        });
      }
    } else {
      // No tags at all
      apkosWithoutTags.push(apko);
    }
  });

  // Sort untagged APKOs by creation date (newest first) so new APKOs appear at top
  apkosWithoutTags.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Get all tags and sort them
  const sortedTags = Array.from(tagToApkoMap.keys()).sort((a, b) => {
    const versionA = semver.valid(semver.coerce(a));
    const versionB = semver.valid(semver.coerce(b));

    // Both are valid semver - compare semantically
    if (versionA && versionB) {
      return semver.rcompare(versionA, versionB); // Descending order (highest first)
    }

    // If one is semver and one isn't, semver comes first
    if (versionA) return -1;
    if (versionB) return 1;

    // Neither is semver - fall back to alphanumeric comparison (descending)
    return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
  });

  // Build the sorted APKO list based on tag order
  // Track which APKOs we've already added to avoid duplicates
  const addedApkoIds = new Set<string>();
  const sortedTaggedApkos: ImageAPKO[] = [];

  sortedTags.forEach(tag => {
    const apko = tagToApkoMap.get(tag);
    if (apko && !addedApkoIds.has(apko.id)) {
      sortedTaggedApkos.push(apko);
      addedApkoIds.add(apko.id);
    }
  });

  // Return: untagged APKOs first (newest first), then tagged APKOs (by version)
  return [...apkosWithoutTags, ...sortedTaggedApkos];
}
