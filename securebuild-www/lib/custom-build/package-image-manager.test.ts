import { determineVersionChangeType, VersionChangeType, isPackageForImage } from './package-image-manager';

describe('isPackageForImage', () => {
  it('should match simple package names', () => {
    expect(isPackageForImage('kubectl', 'kubectl-1.33')).toBe(true);
    expect(isPackageForImage('ruby', 'ruby-3.4')).toBe(true);
  });

  it('should not match unrelated packages', () => {
    expect(isPackageForImage('kubectl', 'ca-certificates-bundle')).toBe(false);
    expect(isPackageForImage('kubectl', 'busybox-1.36')).toBe(false);
    expect(isPackageForImage('kubectl', 'securebuild-baselayout')).toBe(false);
  });

  it('should match subpackages with version in middle', () => {
    expect(isPackageForImage('seaweedfs', 'seaweedfs-3.93')).toBe(true);
    expect(isPackageForImage('seaweedfs', 'seaweedfs-3.93-oci-entrypoint')).toBe(true);
    expect(isPackageForImage('calico-cni', 'calico-cni-3.28')).toBe(true);
    expect(isPackageForImage('calico-cni', 'calico-cni-3.28-compat')).toBe(true);
  });

  it('should match subpackages with version at end', () => {
    expect(isPackageForImage('seaweedfs', 'seaweedfs-oci-entrypoint-3.93')).toBe(true);
    expect(isPackageForImage('fuse3', 'fuse3-3.17')).toBe(true);
    expect(isPackageForImage('fuse3', 'fuse3-3.17-libs')).toBe(true);
  });

  it('should not match packages with similar prefix', () => {
    expect(isPackageForImage('kube', 'kubectl-1.33')).toBe(false);
    expect(isPackageForImage('ruby', 'ruby-dev-tools')).toBe(false);
  });

  it('should match exact image name', () => {
    expect(isPackageForImage('kubectl', 'kubectl-1.33')).toBe(true);
    expect(isPackageForImage('kubectl', 'kubectl-1.33-anything')).toBe(true);
  });
});

describe('determineVersionChangeType', () => {
  it('should detect same version', () => {
    expect(determineVersionChangeType('3.4.6', '3.4.6')).toBe(VersionChangeType.SAME);
    expect(determineVersionChangeType('v3.4.6', '3.4.6')).toBe(VersionChangeType.SAME);
    expect(determineVersionChangeType('3.4.6', 'v3.4.6')).toBe(VersionChangeType.SAME);
    expect(determineVersionChangeType('v3.4.6', 'v3.4.6')).toBe(VersionChangeType.SAME);
  });

  it('should detect patch version changes', () => {
    expect(determineVersionChangeType('3.4.6', '3.4.7')).toBe(VersionChangeType.PATCH);
    expect(determineVersionChangeType('3.4.6', '3.4.10')).toBe(VersionChangeType.PATCH);
    expect(determineVersionChangeType('v3.4.6', '3.4.7')).toBe(VersionChangeType.PATCH);
    expect(determineVersionChangeType('1.0.0', 'v1.0.1')).toBe(VersionChangeType.PATCH);
  });

  it('should detect minor version changes', () => {
    expect(determineVersionChangeType('3.4.6', '3.5.0')).toBe(VersionChangeType.MINOR_OR_MAJOR);
    expect(determineVersionChangeType('3.4.6', '3.5.2')).toBe(VersionChangeType.MINOR_OR_MAJOR);
    expect(determineVersionChangeType('v1.2.3', '1.3.0')).toBe(VersionChangeType.MINOR_OR_MAJOR);
  });

  it('should detect major version changes', () => {
    expect(determineVersionChangeType('3.4.6', '4.0.0')).toBe(VersionChangeType.MINOR_OR_MAJOR);
    expect(determineVersionChangeType('2.1.5', '3.0.0')).toBe(VersionChangeType.MINOR_OR_MAJOR);
    expect(determineVersionChangeType('v1.9.9', '2.0.0')).toBe(VersionChangeType.MINOR_OR_MAJOR);
  });

  it('should handle version strings with v prefix consistently', () => {
    expect(determineVersionChangeType('v1.2.3', 'v1.2.4')).toBe(VersionChangeType.PATCH);
    expect(determineVersionChangeType('v1.2.3', 'v1.3.0')).toBe(VersionChangeType.MINOR_OR_MAJOR);
    expect(determineVersionChangeType('v1.2.3', 'v2.0.0')).toBe(VersionChangeType.MINOR_OR_MAJOR);
  });

  it('should throw error for invalid version formats', () => {
    expect(() => determineVersionChangeType('invalid', '3.4.6')).toThrow('Invalid version format');
    expect(() => determineVersionChangeType('3.4.6', 'not-a-version')).toThrow('Invalid version format');
  });
});
