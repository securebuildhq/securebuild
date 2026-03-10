import { sortAPKOsByVersion } from '../apko-sort';
import type { ImageAPKO } from '../../types/image';

describe('sortAPKOsByVersion', () => {
  const createMockAPKO = (id: string, tags: string[], createdAt?: Date): ImageAPKO => ({
    id,
    name: `apko-${id}`,
    tags,
    createdAt: createdAt || new Date(),
    updatedAt: new Date(),
    readme: null,
    lastBuiltAt: null,
    testYaml: null,
    latestVersion: {
      id: `version-${id}`,
      apkoYaml: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  it('sorts APKOs by semver tags (descending)', () => {
    const apkos = [
      createMockAPKO('1', ['1.0.0']),
      createMockAPKO('2', ['2.1.0']),
      createMockAPKO('3', ['1.5.0']),
    ];

    const sorted = sortAPKOsByVersion(apkos);

    expect(sorted[0].id).toBe('2'); // 2.1.0
    expect(sorted[1].id).toBe('3'); // 1.5.0
    expect(sorted[2].id).toBe('1'); // 1.0.0
  });

  it('excludes "latest" tag from sorting', () => {
    const apkos = [
      createMockAPKO('1', ['1.0.0', 'latest']),
      createMockAPKO('2', ['2.0.0', 'latest']),
    ];

    const sorted = sortAPKOsByVersion(apkos);

    expect(sorted[0].id).toBe('2'); // 2.0.0
    expect(sorted[1].id).toBe('1'); // 1.0.0
  });

  it('handles non-semver tags with alphanumeric sorting', () => {
    const apkos = [
      createMockAPKO('1', ['alpha']),
      createMockAPKO('2', ['beta']),
      createMockAPKO('3', ['gamma']),
    ];

    const sorted = sortAPKOsByVersion(apkos);

    // Descending alphanumeric: gamma > beta > alpha
    expect(sorted[0].id).toBe('3'); // gamma
    expect(sorted[1].id).toBe('2'); // beta
    expect(sorted[2].id).toBe('1'); // alpha
  });

  it('prioritizes semver tags over non-semver tags', () => {
    const apkos = [
      createMockAPKO('1', ['alpha']),
      createMockAPKO('2', ['1.0.0']),
      createMockAPKO('3', ['beta']),
    ];

    const sorted = sortAPKOsByVersion(apkos);

    // Semver first, then non-semver
    expect(sorted[0].id).toBe('2'); // 1.0.0 (semver)
    expect(sorted[1].id).toBe('3'); // beta
    expect(sorted[2].id).toBe('1'); // alpha
  });

  it('places APKOs with no tags at the top (newest first)', () => {
    const now = new Date();
    const older = new Date(now.getTime() - 1000);
    const oldest = new Date(now.getTime() - 2000);

    const apkos = [
      createMockAPKO('1', ['1.0.0'], oldest),
      createMockAPKO('2', [], now), // newest, no tags
      createMockAPKO('3', ['2.0.0'], older),
      createMockAPKO('4', [], older), // older, no tags
    ];

    const sorted = sortAPKOsByVersion(apkos);

    expect(sorted[0].id).toBe('2'); // no tags, newest (at top)
    expect(sorted[1].id).toBe('4'); // no tags, older
    expect(sorted[2].id).toBe('3'); // 2.0.0
    expect(sorted[3].id).toBe('1'); // 1.0.0
  });

  it('places APKOs with only "latest" tag at the top', () => {
    const now = new Date();
    const older = new Date(now.getTime() - 1000);

    const apkos = [
      createMockAPKO('1', ['1.0.0'], older),
      createMockAPKO('2', ['latest'], now),
      createMockAPKO('3', ['2.0.0'], older),
    ];

    const sorted = sortAPKOsByVersion(apkos);

    expect(sorted[0].id).toBe('2'); // only "latest" (at top)
    expect(sorted[1].id).toBe('3'); // 2.0.0
    expect(sorted[2].id).toBe('1'); // 1.0.0
  });

  it('handles APKOs with multiple tags (uses highest tag for sorting)', () => {
    const apkos = [
      createMockAPKO('1', ['1.0.0', '1.0.1']),
      createMockAPKO('2', ['2.0.0', '2.1.0']),
    ];

    const sorted = sortAPKOsByVersion(apkos);

    // The APKO with highest tag (2.1.0) comes first
    expect(sorted[0].id).toBe('2');
    expect(sorted[1].id).toBe('1');
  });

  it('handles semver tags with prefixes (v1.0.0)', () => {
    const apkos = [
      createMockAPKO('1', ['v1.0.0']),
      createMockAPKO('2', ['v2.0.0']),
      createMockAPKO('3', ['v1.5.0']),
    ];

    const sorted = sortAPKOsByVersion(apkos);

    // semver.coerce should handle the 'v' prefix
    expect(sorted[0].id).toBe('2'); // v2.0.0
    expect(sorted[1].id).toBe('3'); // v1.5.0
    expect(sorted[2].id).toBe('1'); // v1.0.0
  });
});
