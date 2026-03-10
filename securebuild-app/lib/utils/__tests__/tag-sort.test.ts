import { sortTagsForDisplay } from '../tag-sort';

describe('sortTagsForDisplay', () => {
  it('sorts all tag patterns correctly', () => {
    const tags = [
      // Version 7 family with different component counts
      '7.4.5',
      '7.4',
      '7',
      '7.4.5-prerelease.1',
      // Non-semver tags (pure text)
      'latest',
      'alpha',
      'charlie'
    ];

    const sorted = sortTagsForDisplay(tags);

    expect(sorted).toEqual([
      'latest',              // Latest always first
      '7',                   // 1 component
      '7.4',                 // 2 components
      '7.4.5',               // 3 components
      '7.4.5-prerelease.1',  // 3 components (prerelease comes after release)
      'alpha',               // Non-semver (alphanumeric)
      'charlie',             // Non-semver (alphanumeric)
    ]);
  });

  it('handles empty array', () => {
    expect(sortTagsForDisplay([])).toEqual([]);
  });

  it('handles single tag', () => {
    expect(sortTagsForDisplay(['1.0.0'])).toEqual(['1.0.0']);
  });
});
