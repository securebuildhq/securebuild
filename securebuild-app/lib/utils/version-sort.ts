import * as semver from 'semver'
import { VersionInfo } from '@/lib/types/package'

/**
 * Sorts version information in ascending order (oldest to newest)
 * Handles both semver and date-based versions
 */
export function sortVersionInfos(versionInfos: VersionInfo[]): VersionInfo[] {
  return [...versionInfos].sort((a, b) => {
    // First compare by version
    const versionCompare = compareVersions(a.version, b.version)
    if (versionCompare !== 0) {
      return versionCompare
    }
    // If versions are equal, compare by apk_release
    return a.apkRelease - b.apkRelease
  })
}

/**
 * Compares two version strings using semver when possible, fallback to numeric string comparison
 */
export function compareVersions(versionA: string, versionB: string): number {
  // Try semver comparison first
  try {
    // Check if both versions are valid semver
    if (semver.valid(versionA) && semver.valid(versionB)) {
      return semver.compare(versionA, versionB)
    }
    
    // Try coercing to semver if they're not valid
    const coercedA = semver.coerce(versionA)
    const coercedB = semver.coerce(versionB)
    if (coercedA && coercedB) {
      return semver.compare(coercedA, coercedB)
    }
  } catch (e) {
    // Fall through to string comparison
  }
  
  // Fall back to lexicographic string comparison for non-semver versions
  // Example: "version2" vs "version10" → without numeric: ["version10", "version2"], with numeric: ["version2", "version10"]
  return versionA.localeCompare(versionB, undefined, { numeric: true })
} 