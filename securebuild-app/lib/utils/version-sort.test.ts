import { sortVersionInfos, compareVersions } from './version-sort'

describe('Version Sorting Utility', () => {
  describe('compareVersions', () => {
    it('should sort semver versions correctly', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0)
      expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0)
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
      expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0)
      expect(compareVersions('1.0.0-alpha.1', '1.0.0-beta.1')).toBeLessThan(0)
    })

    it('should sort date-based versions correctly', () => {
      expect(compareVersions('20230201', '20250701')).toBeLessThan(0)
      expect(compareVersions('20250701', '20230201')).toBeGreaterThan(0)
      expect(compareVersions('20250701', '20250701')).toBe(0)
    })

    it('should sort mixed version types correctly with numeric comparison', () => {
      expect(compareVersions('version2', 'version10')).toBeLessThan(0)
      expect(compareVersions('v1.2.10', 'v1.2.2')).toBeGreaterThan(0)
    })
  })

  describe('sortVersionInfos', () => {
    it('should sort version infos in ascending order', () => {
      const versions = [
        { version: '20250701', apkRelease: 36 },
        { version: '20230201', apkRelease: 1 },
        { version: '20230201', apkRelease: 0 },
        { version: '20250701', apkRelease: 0 },
      ]

      const sorted = sortVersionInfos(versions)

      expect(sorted).toEqual([
        { version: '20230201', apkRelease: 0 },
        { version: '20230201', apkRelease: 1 },
        { version: '20250701', apkRelease: 0 },
        { version: '20250701', apkRelease: 36 },
      ])
    })

    it('should sort by apk_release when versions are equal', () => {
      const versions = [
        { version: '1.0.0', apkRelease: 5 },
        { version: '1.0.0', apkRelease: 1 },
        { version: '1.0.0', apkRelease: 10 },
      ]

      const sorted = sortVersionInfos(versions)

      expect(sorted).toEqual([
        { version: '1.0.0', apkRelease: 1 },
        { version: '1.0.0', apkRelease: 5 },
        { version: '1.0.0', apkRelease: 10 },
      ])
    })

    it('should handle semver versions correctly', () => {
      const versions = [
        { version: '2.0.0', apkRelease: 0 },
        { version: '1.0.0-alpha', apkRelease: 0 },
        { version: '1.0.0', apkRelease: 0 },
        { version: '1.2.0', apkRelease: 0 },
      ]

      const sorted = sortVersionInfos(versions)

      expect(sorted).toEqual([
        { version: '1.0.0-alpha', apkRelease: 0 },
        { version: '1.0.0', apkRelease: 0 },
        { version: '1.2.0', apkRelease: 0 },
        { version: '2.0.0', apkRelease: 0 },
      ])
    })
  })
}) 