import { mergeSBOMs, SPDXDocument, SPDXPackage, SPDXRelationship } from './merger';
import * as fs from 'fs';
import * as path from 'path';

describe('SBOM Merger', () => {
  // Helper function to create a basic SPDX document
  const createBasicSPDXDocument = (
    name: string,
    packages: SPDXPackage[] = [],
    relationships: SPDXRelationship[] = []
  ): SPDXDocument => ({
    SPDXID: 'SPDXRef-DOCUMENT',
    name,
    dataLicense: 'CC0-1.0',
    creationInfo: {
      created: '2024-01-01T00:00:00Z',
      creators: ['Tool: test-creator'],
    },
    spdxVersion: 'SPDX-2.3',
    documentNamespace: `https://test.com/${name}`,
    packages,
    relationships,
  });

  // Helper function to create a basic package
  const createBasicPackage = (
    name: string,
    version: string = '1.0.0',
    spdxId: string = `SPDXRef-${name}`
  ): SPDXPackage => ({
    SPDXID: spdxId,
    name,
    versionInfo: version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
  });

  describe('mergeSBOMs', () => {
    it('should return single SBOM when only one is provided', () => {
      const doc1 = createBasicSPDXDocument('test-doc');
      const sbomString = JSON.stringify(doc1);

      const result = mergeSBOMs([sbomString]);

      expect(result).toEqual(sbomString);
    });

    it('should throw error when no SBOMs are provided', () => {
      expect(() => mergeSBOMs([])).toThrow('No SBOMs provided for merging');
    });

    it('should throw error when invalid JSON is provided', () => {
      const validJson = JSON.stringify(createBasicSPDXDocument('valid'));
      const invalidJson = '{ "name": "test"';

      expect(() => mergeSBOMs([validJson, invalidJson])).toThrow();
    });

    it('should merge two simple SBOMs successfully', () => {
      const pkg1 = createBasicPackage('package1', '1.0.0');
      const pkg2 = createBasicPackage('package2', '2.0.0');

      const doc1 = createBasicSPDXDocument('doc1', [pkg1]);
      const doc2 = createBasicSPDXDocument('doc2', [pkg2]);

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.name).toBe('Combined SBOM');
      expect(merged.packages).toHaveLength(2);
      expect(merged.packages.map(p => p.name)).toContain('package1');
      expect(merged.packages.map(p => p.name)).toContain('package2');
    });

    it('should deduplicate identical packages', () => {
      const pkg1 = createBasicPackage('duplicate-package', '1.0.0');
      const pkg2 = createBasicPackage('duplicate-package', '1.0.0');

      const doc1 = createBasicSPDXDocument('doc1', [pkg1]);
      const doc2 = createBasicSPDXDocument('doc2', [pkg2]);

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.packages).toHaveLength(1);
      expect(merged.packages[0].name).toBe('duplicate-package');
    });

    it('should merge packages with same name but different versions', () => {
      const pkg1 = createBasicPackage('same-name', '1.0.0');
      const pkg2 = createBasicPackage('same-name', '2.0.0');

      const doc1 = createBasicSPDXDocument('doc1', [pkg1]);
      const doc2 = createBasicSPDXDocument('doc2', [pkg2]);

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.packages).toHaveLength(2);
      const packageNames = merged.packages.map(p => `${p.name}:${p.versionInfo}`);
      expect(packageNames).toContain('same-name:1.0.0');
      expect(packageNames).toContain('same-name:2.0.0');
    });

    it('should merge external references from duplicate packages', () => {
      const pkg1 = createBasicPackage('test-package', '1.0.0');
      pkg1.externalRefs = [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: 'pkg:npm/test-package@1.0.0',
        }
      ];

      const pkg2 = createBasicPackage('test-package', '1.0.0');
      pkg2.externalRefs = [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: 'pkg:npm/test-package@1.0.0',
        },
        {
          referenceCategory: 'OTHER',
          referenceType: 'website',
          referenceLocator: 'https://example.com',
        }
      ];

      const doc1 = createBasicSPDXDocument('doc1', [pkg1]);
      const doc2 = createBasicSPDXDocument('doc2', [pkg2]);

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.packages).toHaveLength(1);
      expect(merged.packages[0].externalRefs).toHaveLength(2);
    });

    it('should handle packages with different SPDX IDs correctly', () => {
      const pkg1 = createBasicPackage('package1', '1.0.0', 'SPDXRef-Package-1');
      const pkg2 = createBasicPackage('package2', '2.0.0', 'SPDXRef-Package-2');

      const doc1 = createBasicSPDXDocument('doc1', [pkg1]);
      const doc2 = createBasicSPDXDocument('doc2', [pkg2]);

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.packages).toHaveLength(2);
      expect(merged.packages[0].SPDXID).toMatch(/^SPDXRef-Doc\d+-/);
      expect(merged.packages[1].SPDXID).toMatch(/^SPDXRef-Doc\d+-/);
      expect(merged.packages[0].SPDXID).not.toEqual(merged.packages[1].SPDXID);
    });

    it('should merge relationships with updated SPDX IDs', () => {
      const pkg1 = createBasicPackage('package1', '1.0.0', 'SPDXRef-Package1');
      const rel1: SPDXRelationship = {
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
        relatedSpdxElement: 'SPDXRef-Package1',
      };

      const doc1 = createBasicSPDXDocument('doc1', [pkg1], [rel1]);
      const doc2 = createBasicSPDXDocument('doc2', []);

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.relationships).toHaveLength(1);
      expect(merged.relationships[0].relationshipType).toBe('DESCRIBES');
      expect(merged.relationships[0].relatedSpdxElement).toMatch(/^SPDXRef-Doc\d+-Package1$/);
    });

    it('should handle license information merging', () => {
      const pkg1 = createBasicPackage('test-package', '1.0.0');
      pkg1.licenseConcluded = 'MIT';
      pkg1.licenseDeclared = 'NOASSERTION';

      const pkg2 = createBasicPackage('test-package', '1.0.0');
      pkg2.licenseConcluded = 'NOASSERTION';
      pkg2.licenseDeclared = 'Apache-2.0';

      const doc1 = createBasicSPDXDocument('doc1', [pkg1]);
      const doc2 = createBasicSPDXDocument('doc2', [pkg2]);

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.packages).toHaveLength(1);
      expect(merged.packages[0].licenseConcluded).toBe('MIT');
      expect(merged.packages[0].licenseDeclared).toBe('Apache-2.0');
    });

    it('should create external document references', () => {
      const doc1 = createBasicSPDXDocument('doc1');
      const doc2 = createBasicSPDXDocument('doc2');

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.externalDocumentRefs).toHaveLength(2);
      expect(merged.externalDocumentRefs?.[0].externalDocumentId).toMatch(/^DocumentRef-Doc\d+$/);
      expect(merged.externalDocumentRefs?.[1].externalDocumentId).toMatch(/^DocumentRef-Doc\d+$/);
    });

    it('should handle checksums merging', () => {
      const pkg1 = createBasicPackage('test-package', '1.0.0');
      pkg1.checksums = [
        { algorithm: 'SHA1', checksumValue: 'abc123' }
      ];

      const pkg2 = createBasicPackage('test-package', '1.0.0');
      pkg2.checksums = [
        { algorithm: 'SHA256', checksumValue: 'def456' }
      ];

      const doc1 = createBasicSPDXDocument('doc1', [pkg1]);
      const doc2 = createBasicSPDXDocument('doc2', [pkg2]);

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.packages).toHaveLength(1);
      expect(merged.packages[0].checksums).toHaveLength(2);
      expect(merged.packages[0].checksums).toContainEqual({ algorithm: 'SHA1', checksumValue: 'abc123' });
      expect(merged.packages[0].checksums).toContainEqual({ algorithm: 'SHA256', checksumValue: 'def456' });
    });

    it('should not duplicate identical checksums', () => {
      const pkg1 = createBasicPackage('test-package', '1.0.0');
      pkg1.checksums = [
        { algorithm: 'SHA1', checksumValue: 'abc123' }
      ];

      const pkg2 = createBasicPackage('test-package', '1.0.0');
      pkg2.checksums = [
        { algorithm: 'SHA1', checksumValue: 'abc123' }
      ];

      const doc1 = createBasicSPDXDocument('doc1', [pkg1]);
      const doc2 = createBasicSPDXDocument('doc2', [pkg2]);

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.packages).toHaveLength(1);
      expect(merged.packages[0].checksums).toHaveLength(1);
      expect(merged.packages[0].checksums?.[0]).toEqual({ algorithm: 'SHA1', checksumValue: 'abc123' });
    });

    it('should handle package manager external references for deduplication', () => {
      const pkg1 = createBasicPackage('lodash', '4.17.21');
      pkg1.externalRefs = [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: 'pkg:npm/lodash@4.17.21',
        }
      ];

      const pkg2 = createBasicPackage('lodash', '4.17.21');
      pkg2.externalRefs = [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: 'pkg:npm/lodash@4.17.21',
        }
      ];

      const doc1 = createBasicSPDXDocument('doc1', [pkg1]);
      const doc2 = createBasicSPDXDocument('doc2', [pkg2]);

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.packages).toHaveLength(1);
      expect(merged.packages[0].name).toBe('lodash');
      expect(merged.packages[0].versionInfo).toBe('4.17.21');
    });

    it('should preserve document describes relationships', () => {
      const pkg1 = createBasicPackage('package1', '1.0.0');
      const pkg2 = createBasicPackage('package2', '2.0.0');

      const doc1 = createBasicSPDXDocument('doc1', [pkg1]);
      const doc2 = createBasicSPDXDocument('doc2', [pkg2]);

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.documentDescribes).toHaveLength(2);
      expect(merged.documentDescribes?.every(id => id.startsWith('SPDXRef-Doc'))).toBe(true);
    });

    it('should generate valid creation info for merged document', () => {
      const doc1 = createBasicSPDXDocument('doc1');
      const doc2 = createBasicSPDXDocument('doc2');

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.creationInfo.creators).toEqual(['Tool: SecureBuild SBOM Merger']);
      expect(merged.creationInfo.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(merged.documentNamespace).toMatch(/^https:\/\/securebuild\.io\/merged-sbom\/\d+$/);
    });

    it('should handle complex merging scenario with many packages', () => {
      const packages1 = [
        createBasicPackage('react', '18.2.0'),
        createBasicPackage('lodash', '4.17.21'),
        createBasicPackage('express', '4.18.2'),
      ];

      const packages2 = [
        createBasicPackage('lodash', '4.17.21'), // duplicate
        createBasicPackage('axios', '1.4.0'),
        createBasicPackage('moment', '2.29.4'),
      ];

      const packages3 = [
        createBasicPackage('react', '18.3.0'), // different version
        createBasicPackage('typescript', '5.1.6'),
      ];

      const doc1 = createBasicSPDXDocument('doc1', packages1);
      const doc2 = createBasicSPDXDocument('doc2', packages2);
      const doc3 = createBasicSPDXDocument('doc3', packages3);

      const result = mergeSBOMs(
        [JSON.stringify(doc1), JSON.stringify(doc2), JSON.stringify(doc3)],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      expect(merged.packages).toHaveLength(7); // 8 total - 1 duplicate lodash

      const packageIdentifiers = merged.packages.map(p => `${p.name}:${p.versionInfo}`);
      expect(packageIdentifiers).toContain('react:18.2.0');
      expect(packageIdentifiers).toContain('react:18.3.0');
      expect(packageIdentifiers).toContain('lodash:4.17.21');
      expect(packageIdentifiers).toContain('express:4.18.2');
      expect(packageIdentifiers).toContain('axios:1.4.0');
      expect(packageIdentifiers).toContain('moment:2.29.4');
      expect(packageIdentifiers).toContain('typescript:5.1.6');

      // Should only have one lodash package
      const lodashPackages = merged.packages.filter(p => p.name === 'lodash');
      expect(lodashPackages).toHaveLength(1);
    });

    it('should merge real test SBOMs from testdata directory', () => {
      // Read the test SBOM files
      const testDataDir = path.join(__dirname, 'testdata');
      const alpineSbomPath = path.join(testDataDir, 'alpine-latest.sbom');
      const helloWorldSbomPath = path.join(testDataDir, 'hello-world-latest.sbom');

      const alpineSbom = fs.readFileSync(alpineSbomPath, 'utf8');
      const helloWorldSbom = fs.readFileSync(helloWorldSbomPath, 'utf8');

      // Merge the SBOMs
      const result = mergeSBOMs(
        [alpineSbom, helloWorldSbom],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      // Validate the merged document structure
      expect(merged.name).toBe('Combined SBOM');
      expect(merged.SPDXID).toBe('SPDXRef-DOCUMENT');
      expect(merged.spdxVersion).toBe('SPDX-2.3');
      expect(merged.dataLicense).toBe('CC0-1.0');

      // Validate that packages from both SBOMs are present
      expect(merged.packages.length).toBeGreaterThan(0);

      // The alpine SBOM should contribute packages like these common Alpine Linux packages
      const mergedPackageNames = merged.packages.map(p => p.name);
      expect(mergedPackageNames).toContain('alpine-baselayout');
      expect(mergedPackageNames).toContain('busybox');
      expect(mergedPackageNames).toContain('musl');
      expect(mergedPackageNames).toContain('ca-certificates-bundle');
      expect(mergedPackageNames).toContain('scanelf');
      expect(mergedPackageNames).toContain('ssl_client');
      expect(mergedPackageNames).toContain('zlib');
      expect(mergedPackageNames).toContain('index.docker.io/library/alpine');

      // the hello-world SBOM should contribute the hello-world image package (it's very small)
      expect(mergedPackageNames).toContain('index.docker.io/library/hello-world');

      // Validate that SPDX IDs have been updated with doc prefixes
      const packageIds = merged.packages.map(p => p.SPDXID);
      expect(packageIds.every(id => id.startsWith('SPDXRef-Doc'))).toBe(true);

      // Validate external document references are created
      expect(merged.externalDocumentRefs).toHaveLength(2);
      expect(merged.externalDocumentRefs?.[0].externalDocumentId).toMatch(/^DocumentRef-Doc\d+$/);
      expect(merged.externalDocumentRefs?.[1].externalDocumentId).toMatch(/^DocumentRef-Doc\d+$/);

      // Validate creation info
      expect(merged.creationInfo.creators).toEqual(['Tool: SecureBuild SBOM Merger']);
      expect(merged.creationInfo.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(merged.documentNamespace).toMatch(/^https:\/\/securebuild\.io\/merged-sbom\/\d+$/);

      // Validate documentDescribes contains references to packages from both documents
      expect(merged.documentDescribes?.length).toBeGreaterThan(0);
      expect(merged.documentDescribes?.every(id => id.startsWith('SPDXRef-Doc'))).toBe(true);

      console.log(`Merged SBOM contains ${merged.packages.length} packages from both alpine and hello-world images`);
    });

    it('should merge four real SBOMs with proper deduplication', () => {
      // Read SBOM files - use alpine-latest twice to force deduplication
      const testDataDir = path.join(__dirname, 'testdata');
      const alpineLatestSbomPath = path.join(testDataDir, 'alpine-latest.sbom');
      const alpine321SbomPath = path.join(testDataDir, 'alpine-321.sbom');
      const helloWorldSbomPath = path.join(testDataDir, 'hello-world-latest.sbom');

      const alpineLatestSbom = fs.readFileSync(alpineLatestSbomPath, 'utf8');
      const alpine321Sbom = fs.readFileSync(alpine321SbomPath, 'utf8');
      const helloWorldSbom = fs.readFileSync(helloWorldSbomPath, 'utf8');

      // Parse original SBOMs to count packages before merging
      const alpineLatestDoc = JSON.parse(alpineLatestSbom) as SPDXDocument;
      const alpine321Doc = JSON.parse(alpine321Sbom) as SPDXDocument;
      const helloWorldDoc = JSON.parse(helloWorldSbom) as SPDXDocument;

      // Use alpine-latest SBOM twice to demonstrate deduplication
      const totalOriginalPackages = alpineLatestDoc.packages.length + alpineLatestDoc.packages.length + alpine321Doc.packages.length + helloWorldDoc.packages.length;

      // Merge all four SBOMs (alpine-latest is included twice to force deduplication)
      const result = mergeSBOMs(
        [alpineLatestSbom, alpineLatestSbom, alpine321Sbom, helloWorldSbom],
      );

      const merged = JSON.parse(result) as SPDXDocument;

      // Validate the merged document structure
      expect(merged.name).toBe('Combined SBOM');
      expect(merged.SPDXID).toBe('SPDXRef-DOCUMENT');
      expect(merged.spdxVersion).toBe('SPDX-2.3');
      expect(merged.dataLicense).toBe('CC0-1.0');

      // Validate that packages from all SBOMs are present (the sum should be greater than any individual SBOM)
      expect(merged.packages.length).toBeGreaterThan(alpineLatestDoc.packages.length);
      expect(merged.packages.length).toBeGreaterThan(alpine321Doc.packages.length);
      expect(merged.packages.length).toBeGreaterThan(helloWorldDoc.packages.length);

      // Since alpine-latest is included twice, deduplication should occur
      // The merged SBOM should have fewer packages than the sum of all four
      expect(merged.packages.length).toBeLessThan(totalOriginalPackages);

      // Validate that common Alpine packages are present
      const mergedPackageNames = merged.packages.map(p => p.name);
      expect(mergedPackageNames).toContain('alpine-baselayout');
      expect(mergedPackageNames).toContain('busybox');
      expect(mergedPackageNames).toContain('musl');
      expect(mergedPackageNames).toContain('ca-certificates-bundle');

      // Validate that all three image packages are present
      expect(mergedPackageNames).toContain('index.docker.io/library/alpine');
      expect(mergedPackageNames).toContain('index.docker.io/library/hello-world');

      // Validate that SPDX IDs have been updated with doc prefixes
      const packageIds = merged.packages.map(p => p.SPDXID);
      expect(packageIds.every(id => id.startsWith('SPDXRef-Doc'))).toBe(true);

      // Validate external document references are created for all three documents
      expect(merged.externalDocumentRefs).toHaveLength(3);
      expect(merged.externalDocumentRefs?.every(ref =>
        ref.externalDocumentId.match(/^DocumentRef-Doc\d+$/)
      )).toBe(true);

      // Validate creation info
      expect(merged.creationInfo.creators).toEqual(['Tool: SecureBuild SBOM Merger']);
      expect(merged.creationInfo.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(merged.documentNamespace).toMatch(/^https:\/\/securebuild\.io\/merged-sbom\/\d+$/);

      // Check for specific packages that should definitely be deduplicated
      // These packages exist in alpine-latest (which we included twice) and should appear exactly once
      const alpineLatestPackageNames = alpineLatestDoc.packages.map(p => p.name);
      const packagesToCheck = ['alpine-baselayout', 'busybox', 'musl']; // Known to exist in alpine-latest

      packagesToCheck.forEach(packageName => {
        if (alpineLatestPackageNames.includes(packageName)) {
          const packagesWithName = merged.packages.filter(p => p.name === packageName);

          // Should have at least 1 instance (from alpine-latest deduplication)
          expect(packagesWithName.length).toBeGreaterThanOrEqual(1);

          // Should have at most 2 instances (from alpine-latest and alpine-321)
          expect(packagesWithName.length).toBeLessThanOrEqual(2);

          // If alpine-321 has a different version of the same package, we might have 2 total
          // But the alpine-latest duplicates should definitely be merged into 1
          const fromAlpineLatest = merged.packages.filter(p =>
            p.name === packageName && p.SPDXID.startsWith('SPDXRef-Doc0-')
          );
          expect(fromAlpineLatest).toHaveLength(1); // Exactly one from the first alpine-latest

          // Should NOT have any from the duplicate alpine-latest (Doc1)
          const fromDuplicateAlpineLatest = merged.packages.filter(p =>
            p.name === packageName && p.SPDXID.startsWith('SPDXRef-Doc1-')
          );
          expect(fromDuplicateAlpineLatest).toHaveLength(0); // Should be deduplicated
        }
      });

      console.log(`Merged SBOM contains ${merged.packages.length} packages from alpine:latest-1 (${alpineLatestDoc.packages.length}), alpine:latest-2 (${alpineLatestDoc.packages.length}), alpine:3.21 (${alpine321Doc.packages.length}), and hello-world (${helloWorldDoc.packages.length})`);
      console.log(`Deduplication saved ${totalOriginalPackages - merged.packages.length} duplicate packages`);
    });
  });
});