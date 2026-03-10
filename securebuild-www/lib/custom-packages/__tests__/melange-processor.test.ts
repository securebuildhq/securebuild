import { 
  decompressBase64Content,
  processVendorMelange,
  validateMelangeStructure,
  extractRepositoryUrls
} from '../melange-processor';
import { gzipSync } from 'zlib';

describe('melange-processor', () => {
  describe('decompressBase64Content', () => {
    it('should decompress base64-encoded gzipped content', () => {
      const originalContent = 'Hello, World!';
      const compressed = gzipSync(Buffer.from(originalContent, 'utf8'));
      const base64Content = compressed.toString('base64');
      
      const decompressed = decompressBase64Content(base64Content);
      expect(decompressed).toBe(originalContent);
    });

    it('should handle YAML content correctly', () => {
      const yamlContent = `
package:
  name: test-package
  version: 1.0.0
  description: Test package
environment:
  contents:
    packages:
      - build-base
pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/example/repo
      expected-commit: abc123
`.trim();
      
      const compressed = gzipSync(Buffer.from(yamlContent, 'utf8'));
      const base64Content = compressed.toString('base64');
      
      const decompressed = decompressBase64Content(base64Content);
      expect(decompressed).toBe(yamlContent);
    });

    it('should throw error for invalid base64', () => {
      expect(() => {
        decompressBase64Content('invalid-base64!@#$');
      }).toThrow('Failed to decompress content');
    });

    it('should throw error for non-gzipped base64', () => {
      const plainText = Buffer.from('not gzipped', 'utf8').toString('base64');
      
      expect(() => {
        decompressBase64Content(plainText);
      }).toThrow('Failed to decompress content');
    });
  });

  describe('processVendorMelange', () => {
    const validMelangeYaml = `
package:
  name: test-package
  version: 1.0.0
  description: Test package
environment:
  contents:
    packages:
      - build-base
pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/example/repo
      expected-commit: abc123def456
`.trim();

    it('should process valid melange configuration', () => {
      const result = processVendorMelange(validMelangeYaml);
      
      expect(result.packageName).toBe('test-package');
      expect(result.version).toBe('1.0.0');
      expect(result.allNames).toContain('test-package');
      expect(result.yaml).toContain('test-package');
    });

    it('should extract subpackage names', () => {
      const yamlWithSubpackages = `
package:
  name: main-package
  version: 1.0.0
  description: Main package
subpackages:
  - name: main-package-dev
    description: Development files
  - name: main-package-doc
    description: Documentation
environment:
  contents:
    packages:
      - build-base
pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/example/repo
      expected-commit: abc123def456
`.trim();

      const result = processVendorMelange(yamlWithSubpackages);
      
      expect(result.packageName).toBe('main-package');
      expect(result.subpackages).toEqual(['main-package-dev', 'main-package-doc']);
      expect(result.allNames).toEqual(['main-package', 'main-package-dev', 'main-package-doc']);
    });

    it('should extract provides arrays', () => {
      const yamlWithProvides = `
package:
  name: main-package
  version: 1.0.0
  description: Main package
  provides:
    - virtual-package-1
    - virtual-package-2
subpackages:
  - name: main-package-dev
    provides:
      - dev-virtual-1
environment:
  contents:
    packages:
      - build-base
pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/example/repo
      expected-commit: abc123def456
`.trim();

      const result = processVendorMelange(yamlWithProvides);
      
      expect(result.provides).toEqual(['virtual-package-1', 'virtual-package-2', 'dev-virtual-1']);
      expect(result.allNames).toContain('virtual-package-1');
      expect(result.allNames).toContain('dev-virtual-1');
    });

    it('should replace tag with expected-commit requirement', () => {
      const yamlWithTag = `
package:
  name: test-package
  version: 1.0.0
  description: Test package
environment:
  contents:
    packages:
      - build-base
pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/example/repo
      tag: v1.0.0
      expected-commit: abc123def456
`.trim();

      const result = processVendorMelange(yamlWithTag);
      
      // Should remove tag and keep expected-commit
      expect(result.yaml).not.toContain('tag:');
      expect(result.yaml).toContain('expected-commit: abc123def456');
    });

    it('should reject git-checkout with tag but no expected-commit', () => {
      const yamlWithTagOnly = `
package:
  name: test-package
  version: 1.0.0
  description: Test package
environment:
  contents:
    packages:
      - build-base
pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/example/repo
      tag: v1.0.0
`.trim();

      expect(() => {
        processVendorMelange(yamlWithTagOnly);
      }).toThrow('When using git-checkout, you must provide \'expected-commit\' instead of \'tag\' for vendor packages');
    });

    it('should validate public repository URLs', () => {
      const yamlWithPrivateRepo = `
package:
  name: test-package
  version: 1.0.0
  description: Test package
environment:
  contents:
    packages:
      - build-base
pipeline:
  - uses: git-checkout
    with:
      repository: https://gitlab.com/private/repo
      expected-commit: abc123def456
`.trim();

      expect(() => {
        processVendorMelange(yamlWithPrivateRepo);
      }).toThrow('Repository must be a public GitHub HTTPS URL');
    });

    it('should reject invalid package names', () => {
      const yamlWithInvalidName = `
package:
  name: Invalid-Package-Name
  version: 1.0.0
  description: Test package
environment:
  contents:
    packages:
      - build-base
pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/example/repo
      expected-commit: abc123def456
`.trim();

      expect(() => {
        processVendorMelange(yamlWithInvalidName);
      }).toThrow('Invalid main package name');
    });

    it('should reject missing package name', () => {
      const yamlMissingName = `
package:
  version: 1.0.0
  description: Test package
environment:
  contents:
    packages:
      - build-base
`.trim();

      expect(() => {
        processVendorMelange(yamlMissingName);
      }).toThrow('Melange configuration must include package.name');
    });

    it('should reject missing package version', () => {
      const yamlMissingVersion = `
package:
  name: test-package
  description: Test package
environment:
  contents:
    packages:
      - build-base
`.trim();

      expect(() => {
        processVendorMelange(yamlMissingVersion);
      }).toThrow('Melange configuration must include package.version');
    });

    it('should handle invalid YAML gracefully', () => {
      const invalidYaml = `
package:
  name: test-package
  version: 1.0.0
invalid yaml structure here: [unclosed array
`.trim();

      expect(() => {
        processVendorMelange(invalidYaml);
      }).toThrow();
    });
  });

  describe('validateMelangeStructure', () => {
    it('should accept valid melange structure', () => {
      const validConfig = {
        package: {
          name: 'test-package',
          version: '1.0.0',
          description: 'Test package'
        },
        environment: {
          contents: {
            packages: ['build-base']
          }
        },
        pipeline: [
          {
            uses: 'git-checkout',
            with: {
              repository: 'https://github.com/example/repo',
              'expected-commit': 'abc123'
            }
          }
        ]
      };

      const errors = validateMelangeStructure(validConfig);
      expect(errors).toEqual([]);
    });

    it('should reject missing package section', () => {
      const configMissingPackage = {
        environment: { contents: { packages: [] } },
        pipeline: []
      };

      const errors = validateMelangeStructure(configMissingPackage);
      expect(errors).toContain("Configuration must include a 'package' section");
    });

    it('should reject missing package.name', () => {
      const config = {
        package: {
          version: '1.0.0',
          description: 'Test'
        },
        environment: { contents: { packages: [] } },
        pipeline: []
      };

      const errors = validateMelangeStructure(config);
      expect(errors).toContain("package.name is required and must be a string");
    });

    it('should reject missing environment section', () => {
      const config = {
        package: {
          name: 'test',
          version: '1.0.0',
          description: 'Test'
        },
        pipeline: []
      };

      const errors = validateMelangeStructure(config);
      expect(errors).toContain("Configuration must include an 'environment' section");
    });

    it('should reject missing pipeline section', () => {
      const config = {
        package: {
          name: 'test',
          version: '1.0.0',
          description: 'Test'
        },
        environment: { contents: [] }
      };

      const errors = validateMelangeStructure(config);
      expect(errors).toContain("Configuration must include a 'pipeline' section");
    });

    it('should reject empty pipeline', () => {
      const config = {
        package: {
          name: 'test',
          version: '1.0.0',
          description: 'Test'
        },
        environment: { contents: { packages: [] } },
        pipeline: []
      };

      const errors = validateMelangeStructure(config);
      expect(errors).toContain("pipeline cannot be empty");
    });
  });

  describe('extractRepositoryUrls', () => {
    it('should extract repository URLs from git-checkout steps', () => {
      const config = {
        pipeline: [
          {
            uses: 'git-checkout',
            with: {
              repository: 'https://github.com/example/repo1',
              'expected-commit': 'abc123'
            }
          },
          {
            uses: 'build',
            with: {
              commands: ['make']
            }
          },
          {
            uses: 'git-checkout',
            with: {
              repository: 'https://github.com/example/repo2',
              'expected-commit': 'def456'
            }
          }
        ]
      };

      const urls = extractRepositoryUrls(config);
      expect(urls).toEqual([
        'https://github.com/example/repo1',
        'https://github.com/example/repo2'
      ]);
    });

    it('should handle missing pipeline gracefully', () => {
      const config = {};
      const urls = extractRepositoryUrls(config);
      expect(urls).toEqual([]);
    });

    it('should remove duplicate URLs', () => {
      const config = {
        pipeline: [
          {
            uses: 'git-checkout',
            with: {
              repository: 'https://github.com/example/repo',
              'expected-commit': 'abc123'
            }
          },
          {
            uses: 'git-checkout',
            with: {
              repository: 'https://github.com/example/repo', // duplicate
              'expected-commit': 'def456'
            }
          }
        ]
      };

      const urls = extractRepositoryUrls(config);
      expect(urls).toEqual(['https://github.com/example/repo']);
    });
  });
});