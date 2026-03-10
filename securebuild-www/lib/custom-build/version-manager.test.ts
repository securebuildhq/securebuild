import { updateMelangeVersion, updateAPKOForCustomBuild } from './version-manager';

describe('updateMelangeVersion', () => {
  it('should update package name, version, epoch, and expected-commit while preserving formatting', () => {
    const melangeYaml = `package:
  name: ruby-3.4
  version: 3.4.6
  epoch: 2
  description: Ruby programming language

pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/ruby/ruby
      expected-commit: a57b6f7709f6c2722b92f07b8b4c48210a51fc40
      depth: 1
  - uses: fetch
    with:
      uri: https://example.com/ruby.tar.gz
`;

    const result = updateMelangeVersion(
      melangeYaml,
      'ruby-3.5',
      '3.5.0',
      0,
      'ccc14f7f7f31453a16667f4640de1714863622ec'
    );

    expect(result).toContain('name: ruby-3.5');
    expect(result).toContain('version: 3.5.0');
    expect(result).toContain('epoch: 0');
    expect(result).toContain('expected-commit: ccc14f7f7f31453a16667f4640de1714863622ec');
    expect(result).not.toContain('a57b6f7709f6c2722b92f07b8b4c48210a51fc40');
    expect(result).toContain('description: Ruby programming language'); // Preserved
  });

  it('should handle YAML without epoch field by throwing error', () => {
    const melangeYaml = `package:
  name: test
  version: 1.0.0
`;

    expect(() => {
      updateMelangeVersion(melangeYaml, 'test', '1.0.1', 0, 'commit');
    }).toThrow('epoch field not found');
  });

  it('should preserve git-checkout when no updatable fields exist', () => {
    const melangeYaml = `package:
  name: ruby-3.4
  version: 3.4.6
  epoch: 2

pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/ruby/ruby
`;

    const result = updateMelangeVersion(
      melangeYaml,
      'ruby-3.4',
      '3.4.7',
      3,
      'newcommit'
    );

    // Should preserve the block as-is since there's no expected-commit or tag to update
    expect(result).toContain('repository: https://github.com/ruby/ruby');
    expect(result).toContain('version: 3.4.7');
    expect(result).toContain('epoch: 3');
  });

  it('should update tag field when it contains semver', () => {
    const melangeYaml = `package:
  name: ruby-3.4
  version: 3.4.6
  epoch: 2

pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/ruby/ruby
      tag: v3.4.6
`;

    const result = updateMelangeVersion(
      melangeYaml,
      'ruby-3.4',
      '3.4.7',
      0,
      'newcommit'
    );

    expect(result).toContain('tag: v3.4.7');
    expect(result).not.toContain('v3.4.6');
  });

  it('should preserve tag field when it contains variable reference', () => {
    const melangeYaml = `package:
  name: kubectl-1.33
  version: 1.33.2
  epoch: 0

pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/kubernetes/kubernetes
      tag: v\${{package.version}}
`;

    const result = updateMelangeVersion(
      melangeYaml,
      'kubectl-1.33',
      '1.33.3',
      0,
      'ccc14f7f7f31453a16667f4640de1714863622ec'
    );

    expect(result).toContain('tag: v${{package.version}}');
    expect(result).toContain('version: 1.33.3');
  });

  it('should update vars.git_commit when it contains SHA', () => {
    const melangeYaml = `package:
  name: kubectl-1.33
  version: 1.33.2
  epoch: 0

vars:
  git_commit: a57b6f7709f6c2722b92f07b8b4c48210a51fc40

pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/kubernetes/kubernetes
      expected-commit: \${{vars.git_commit}}
`;

    const result = updateMelangeVersion(
      melangeYaml,
      'kubectl-1.33',
      '1.33.3',
      0,
      'ccc14f7f7f31453a16667f4640de1714863622ec'
    );

    expect(result).toContain('git_commit: ccc14f7f7f31453a16667f4640de1714863622ec');
    expect(result).toContain('expected-commit: ${{vars.git_commit}}'); // Preserve variable reference
    expect(result).not.toContain('a57b6f7709f6c2722b92f07b8b4c48210a51fc40');
  });

  it('should update expected-commit when it contains hardcoded SHA', () => {
    const melangeYaml = `package:
  name: test-1.0
  version: 1.0.0
  epoch: 0

pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/test/test
      expected-commit: a57b6f7709f6c2722b92f07b8b4c48210a51fc40
`;

    const result = updateMelangeVersion(
      melangeYaml,
      'test-1.0',
      '1.0.1',
      0,
      'ccc14f7f7f31453a16667f4640de1714863622ec'
    );

    expect(result).toContain('expected-commit: ccc14f7f7f31453a16667f4640de1714863622ec');
    expect(result).not.toContain('a57b6f7709f6c2722b92f07b8b4c48210a51fc40');
  });
});

describe('updateAPKOForCustomBuild', () => {
  it('should update package names, versions, environment variables, and annotations', () => {
    const apkoYaml = `contents:
  repositories:
    - https://apk.cve0.io
  keyring:
    - https://apk.cve0.io/key/cve0-signing.rsa.pub
  packages:
    - securebuild-baselayout
    - busybox
    - seaweedfs-3.93=3.93.6
    - seaweedfs-3.93-oci-entrypoint~3.93.6
    - ca-certificates-bundle

environment:
  PATH: /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  SEAWEED_VERSION: 3.93.6

annotations:
  org.opencontainers.image.title: "SeaweedFS 3.93 (3.93.6)"
  org.opencontainers.image.description: "Distributed storage"
`;

    const result = updateAPKOForCustomBuild(
      apkoYaml,
      ['seaweedfs-3.93', 'seaweedfs-3.93-oci-entrypoint'],
      ['seaweedfs-3.94', 'seaweedfs-3.94-oci-entrypoint'],
      '3.94.2'
    );

    // Check package name and version updates (should use tilde)
    expect(result).toContain('seaweedfs-3.94~3.94.2');
    expect(result).toContain('seaweedfs-3.94-oci-entrypoint~3.94.2');
    expect(result).not.toContain('seaweedfs-3.93');
    expect(result).not.toContain('3.93.6');

    // Check environment variable update
    expect(result).toContain('SEAWEED_VERSION: 3.94.2');

    // Check annotation update (both major.minor and full version)
    expect(result).toContain('SeaweedFS 3.94 (3.94.2)');

    // Check unchanged packages remain
    expect(result).toContain('securebuild-baselayout');
    expect(result).toContain('ca-certificates-bundle');
  });

  it('should handle patch version updates with same package names', () => {
    const apkoYaml = `contents:
  packages:
    - ruby-3.4~3.4.6
    - ca-certificates-bundle
`;

    const result = updateAPKOForCustomBuild(
      apkoYaml,
      ['ruby-3.4'],
      ['ruby-3.4'],
      '3.4.7'
    );

    expect(result).toContain('ruby-3.4~3.4.7');
    expect(result).not.toContain('3.4.6');
  });

  it('should preserve YAML formatting and comments', () => {
    const apkoYaml = `contents:
  packages:
    # Core packages
    - busybox
    - ruby-3.4~3.4.6  # Main package
    - ca-certificates-bundle
`;

    const result = updateAPKOForCustomBuild(
      apkoYaml,
      ['ruby-3.4'],
      ['ruby-3.4'],
      'v3.4.7'
    );

    expect(result).toContain('# Core packages');
    expect(result).toContain('# Main package');
    expect(result).toContain('ruby-3.4~3.4.7');
  });

  it('should strip v prefix from version tags', () => {
    const apkoYaml = `contents:
  packages:
    - kubectl-1.33~1.33.2

environment:
  KUBECTL_VERSION: 1.33.2
`;

    const result = updateAPKOForCustomBuild(
      apkoYaml,
      ['kubectl-1.33'],
      ['kubectl-1.33'],
      'v1.33.3'
    );

    expect(result).toContain('kubectl-1.33~1.33.3');
    expect(result).toContain('KUBECTL_VERSION: 1.33.3');
    expect(result).not.toContain('v1.33.3');
  });

  it('should always use tilde for version pinning regardless of original operator', () => {
    const apkoYaml = `contents:
  packages:
    - pkg1-1.0=1.0.0
    - pkg2-1.0>1.0.0
    - pkg3-1.0<1.0.5
    - pkg4-1.0>=1.0.0
`;

    const result = updateAPKOForCustomBuild(
      apkoYaml,
      ['pkg1-1.0', 'pkg2-1.0', 'pkg3-1.0', 'pkg4-1.0'],
      ['pkg1-1.0', 'pkg2-1.0', 'pkg3-1.0', 'pkg4-1.0'],
      '1.0.5'
    );

    expect(result).toContain('pkg1-1.0~1.0.5');
    expect(result).toContain('pkg2-1.0~1.0.5');
    expect(result).toContain('pkg3-1.0~1.0.5');
    expect(result).toContain('pkg4-1.0~1.0.5');
    expect(result).not.toContain('=1.0');
    expect(result).not.toContain('>1.0');
    expect(result).not.toContain('<1.0');
  });
});
