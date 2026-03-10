import { extractBaseName, extractVersion, generateNewPackageName } from './package-image-manager';

describe('extractBaseName', () => {
  it('should extract base name from kubectl-1.33', () => {
    expect(extractBaseName('kubectl-1.33')).toBe('kubectl');
  });

  it('should extract base name from erlang-28 (major-only version)', () => {
    expect(extractBaseName('erlang-28')).toBe('erlang');
  });

  it('should return scanelf unchanged (unversioned)', () => {
    expect(extractBaseName('scanelf')).toBe('scanelf');
  });

  it('should extract base name from rabbitmq-server-4.1', () => {
    expect(extractBaseName('rabbitmq-server-4.1')).toBe('rabbitmq-server');
  });

  it('should return ld-linux unchanged (unversioned)', () => {
    expect(extractBaseName('ld-linux')).toBe('ld-linux');
  });
});

describe('extractVersion', () => {
  it('should extract version from kubectl-1.33', () => {
    expect(extractVersion('kubectl-1.33')).toBe('1.33');
  });

  it('should extract version from erlang-28 (major-only version)', () => {
    expect(extractVersion('erlang-28')).toBe('28');
  });

  it('should return null for scanelf (unversioned)', () => {
    expect(extractVersion('scanelf')).toBe(null);
  });

  it('should extract version from rabbitmq-server-4.1', () => {
    expect(extractVersion('rabbitmq-server-4.1')).toBe('4.1');
  });

  it('should return null for ld-linux (hyphens but no version)', () => {
    expect(extractVersion('ld-linux')).toBe(null);
  });

  it('should extract version from seaweedfs-3.93-oci-entrypoint', () => {
    expect(extractVersion('seaweedfs-3.93-oci-entrypoint')).toBe('3.93');
  });

  it('should extract version from calico-cni-3.28-compat', () => {
    expect(extractVersion('calico-cni-3.28-compat')).toBe('3.28');
  });

  it('should return null for packages with hyphens but no version pattern', () => {
    expect(extractVersion('ca-certificates-bundle')).toBe(null);
    expect(extractVersion('securebuild-baselayout')).toBe(null);
    expect(extractVersion('ruby-dev-tools')).toBe(null);
  });

  it('should handle edge cases', () => {
    expect(extractVersion('package-1')).toBe('1');
    expect(extractVersion('package-1.0')).toBe('1.0');
    expect(extractVersion('package-10.20')).toBe('10.20');
    expect(extractVersion('package-0.1')).toBe('0.1');
  });
});

describe('generateNewPackageName', () => {
  it('should generate new package name for kubectl-1.33', () => {
    expect(generateNewPackageName('kubectl-1.33', '1.34.0')).toBe('kubectl-1.34');
  });

  it('should handle erlang-28 (major-only version)', () => {
    expect(generateNewPackageName('erlang-28', '29.0')).toBe('erlang-29');
  });

  it('should handle scanelf (unversioned package)', () => {
    expect(generateNewPackageName('scanelf', '1.0.0')).toBe('scanelf');
  });

  it('should generate new package name for rabbitmq-server-4.1', () => {
    expect(generateNewPackageName('rabbitmq-server-4.1', '4.2.0')).toBe('rabbitmq-server-4.2');
  });

  it('should handle ld-linux (unversioned package)', () => {
    expect(generateNewPackageName('ld-linux', '2.39')).toBe('ld-linux');
  });
});
