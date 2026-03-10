import { bumpReleaseInMelangeYAML, extractPackageInfoFromMelange } from './package';

describe('bumpReleaseInMelangeYAML', () => {
  test('should increment epoch field correctly', () => {
    const yaml = `package:
  name: ca-certificates
  version: "20241121"
  epoch: 49
  description: Test package`;

    const result = bumpReleaseInMelangeYAML(yaml, 50);

    expect(result).toBe(`package:
  name: ca-certificates
  version: "20241121"
  epoch: 50
  description: Test package`);
  });

  test('should preserve whitespace and indentation', () => {
    const yaml = `package:
  name: test-package
  version: "1.0.0"
    epoch: 20
  description: Test`;

    const result = bumpReleaseInMelangeYAML(yaml, 21);

    expect(result).toBe(`package:
  name: test-package
  version: "1.0.0"
    epoch: 21
  description: Test`);
  });

  test('should handle epoch with tabs for indentation', () => {
    const yaml = `package:
\tname: test-package
\tversion: "1.0.0"
\tepoch: 5
\tdescription: Test`;

    const result = bumpReleaseInMelangeYAML(yaml, 6);

    expect(result).toBe(`package:
\tname: test-package
\tversion: "1.0.0"
\tepoch: 6
\tdescription: Test`);
  });

  test('should handle epoch with mixed spaces and tabs', () => {
    const yaml = `package:
  name: test-package
  version: "1.0.0"
  \t  epoch: 100
  description: Test`;

    const result = bumpReleaseInMelangeYAML(yaml, 101);

    expect(result).toBe(`package:
  name: test-package
  version: "1.0.0"
  \t  epoch: 101
  description: Test`);
  });

  test('should only update first occurrence of epoch', () => {
    const yaml = `package:
  name: test-package
  version: "1.0.0"
  epoch: 10
  description: Test
subpackages:
  - name: test-subpackage
    epoch: 5`;

    const result = bumpReleaseInMelangeYAML(yaml, 11);

    expect(result).toBe(`package:
  name: test-package
  version: "1.0.0"
  epoch: 11
  description: Test
subpackages:
  - name: test-subpackage
    epoch: 5`);
  });

  test('should handle epoch at different indentation levels', () => {
    const yaml = `package:
  name: test-package
  version: "1.0.0"
      epoch: 42
  description: Test`;

    const result = bumpReleaseInMelangeYAML(yaml, 43);

    expect(result).toBe(`package:
  name: test-package
  version: "1.0.0"
      epoch: 43
  description: Test`);
  });

  test('should throw error when epoch field is not found', () => {
    const yaml = `package:
  name: test-package
  version: "1.0.0"
  description: Test package without epoch`;

    expect(() => {
      bumpReleaseInMelangeYAML(yaml, 1);
    }).toThrow('epoch field not found in melange YAML');
  });

  test('should handle epoch at the beginning of file', () => {
    const yaml = `epoch: 1
package:
  name: test-package
  version: "1.0.0"`;

    const result = bumpReleaseInMelangeYAML(yaml, 2);

    expect(result).toBe(`epoch: 2
package:
  name: test-package
  version: "1.0.0"`);
  });

  test('should handle epoch with no indentation', () => {
    const yaml = `package:
name: test-package
version: "1.0.0"
epoch: 25
description: Test`;

    const result = bumpReleaseInMelangeYAML(yaml, 26);

    expect(result).toBe(`package:
name: test-package
version: "1.0.0"
epoch: 26
description: Test`);
  });

  test('should handle large epoch numbers', () => {
    const yaml = `package:
  name: test-package
  version: "1.0.0"
  epoch: 999999
  description: Test`;

    const result = bumpReleaseInMelangeYAML(yaml, 1000000);

    expect(result).toBe(`package:
  name: test-package
  version: "1.0.0"
  epoch: 1000000
  description: Test`);
  });
});

describe('extractPackageInfoFromMelange', () => {
  test('should extract package name and version correctly', () => {
    const yaml = `package:
  name: ca-certificates
  version: "20241121"
  epoch: 49
  description: Test package`;

    const result = extractPackageInfoFromMelange(yaml);

    expect(result).toEqual({
      name: 'ca-certificates',
      version: '20241121'
    });
  });

  test('should handle quoted versions', () => {
    const yaml = `package:
  name: test-package
  version: "1.0.0"
  epoch: 0`;

    const result = extractPackageInfoFromMelange(yaml);

    expect(result).toEqual({
      name: 'test-package',
      version: '1.0.0'
    });
  });

  test('should handle unquoted versions', () => {
    const yaml = `package:
  name: test-package
  version: 1.0.0
  epoch: 0`;

    const result = extractPackageInfoFromMelange(yaml);

    expect(result).toEqual({
      name: 'test-package',
      version: '1.0.0'
    });
  });

  test('should throw ValidationError for invalid YAML', () => {
    const yaml = `package:
  name: test
  version: "1.0.0"
invalid: [unclosed bracket`;

    expect(() => extractPackageInfoFromMelange(yaml)).toThrow('Invalid YAML:');
  });

  test('should throw ValidationError when no package section', () => {
    const yaml = `environment:
  contents:
    packages:
      - build-tools`;

    expect(() => extractPackageInfoFromMelange(yaml)).toThrow('Missing or invalid package section');
  });

  test('should handle missing name or version fields', () => {
    const yaml = `package:
  epoch: 0
  description: Test package`;

    const result = extractPackageInfoFromMelange(yaml);

    expect(result).toEqual({
      name: undefined,
      version: undefined
    });
  });

  test('should handle complex melange YAML with subpackages', () => {
    const yaml = `package:
  name: complex-package
  version: "2.1.0"
  epoch: 5
  description: Complex package with subpackages

subpackages:
  - name: complex-package-dev
    pipeline:
      - uses: split/dev
  - name: complex-package-doc
    pipeline:
      - uses: split/manpages`;

    const result = extractPackageInfoFromMelange(yaml);

    expect(result).toEqual({
      name: 'complex-package',
      version: '2.1.0'
    });
  });
});