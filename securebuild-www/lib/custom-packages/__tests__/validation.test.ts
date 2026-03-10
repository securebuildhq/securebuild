import { 
  extractAllPackageNames, 
  validatePackageNameFormat,
  checkAllNameConflicts
} from '../validation';
import { getDB } from '../../data/db';

// Mock database module
jest.mock('../../data/db', () => ({
  getDB: jest.fn(() => ({
    query: jest.fn()
  }))
}));

jest.mock('../../data/param', () => ({
  getParam: jest.fn(() => Promise.resolve('mock-db-uri'))
}));

describe('validation', () => {
  describe('extractAllPackageNames', () => {
    it('should extract main package name', () => {
      const config = {
        package: {
          name: 'test-package'
        }
      };
      
      const names = extractAllPackageNames(config);
      expect(names).toEqual(['test-package']);
    });

    it('should extract subpackage names', () => {
      const config = {
        package: {
          name: 'test-package'
        },
        subpackages: [
          { name: 'test-package-dev' },
          { name: 'test-package-doc' }
        ]
      };
      
      const names = extractAllPackageNames(config);
      expect(names).toEqual(['test-package', 'test-package-dev', 'test-package-doc']);
    });

    it('should extract provides arrays from main package', () => {
      const config = {
        package: {
          name: 'test-package',
          provides: ['virtual-package-1', 'virtual-package-2']
        }
      };
      
      const names = extractAllPackageNames(config);
      expect(names).toEqual(['test-package', 'virtual-package-1', 'virtual-package-2']);
    });

    it('should extract provides arrays from subpackages', () => {
      const config = {
        package: {
          name: 'test-package'
        },
        subpackages: [
          { 
            name: 'test-package-dev',
            provides: ['dev-virtual-1', 'dev-virtual-2'] 
          }
        ]
      };
      
      const names = extractAllPackageNames(config);
      expect(names).toEqual(['test-package', 'test-package-dev', 'dev-virtual-1', 'dev-virtual-2']);
    });

    it('should remove duplicates and empty strings', () => {
      const config = {
        package: {
          name: 'test-package',
          provides: ['test-package', 'virtual-package', ''] // duplicate and empty
        },
        subpackages: [
          { 
            name: 'test-sub',
            provides: ['virtual-package', null] // duplicate and null
          }
        ]
      };
      
      const names = extractAllPackageNames(config);
      expect(names).toEqual(expect.arrayContaining(['test-package', 'virtual-package', 'test-sub']));
      expect(names).toHaveLength(3);
    });

    it('should handle missing sections gracefully', () => {
      const config = {};
      
      const names = extractAllPackageNames(config);
      expect(names).toEqual([]);
    });
  });

  describe('validatePackageNameFormat', () => {
    it('should accept valid package names', () => {
      const validNames = [
        'package',
        'test-package',
        'test_package',
        'package123',
        'package.name',
        'a1b2c3',
        'lib-test-dev'
      ];

      for (const name of validNames) {
        expect(validatePackageNameFormat(name)).toBeNull();
      }
    });

    it('should reject invalid package names', () => {
      const invalidCases = [
        { name: '', expected: 'Package name must be a non-empty string' },
        { name: '   ', expected: 'Package name cannot be empty' },
        { name: 'Package', expected: 'Package name must start with alphanumeric character and contain only lowercase letters, numbers, dots, hyphens, and underscores' },
        { name: 'test-Package', expected: 'Package name must start with alphanumeric character and contain only lowercase letters, numbers, dots, hyphens, and underscores' },
        { name: '-package', expected: 'Package name cannot start or end with special characters (. - _)' },
        { name: 'package-', expected: 'Package name cannot start or end with special characters (. - _)' },
        { name: '.package', expected: 'Package name cannot start or end with special characters (. - _)' },
        { name: 'package.', expected: 'Package name cannot start or end with special characters (. - _)' },
        { name: '_package', expected: 'Package name cannot start or end with special characters (. - _)' },
        { name: 'package_', expected: 'Package name cannot start or end with special characters (. - _)' },
        { name: 'package@special', expected: 'Package name must start with alphanumeric character and contain only lowercase letters, numbers, dots, hyphens, and underscores' },
        { name: 'a'.repeat(65), expected: 'Package name cannot exceed 64 characters' }
      ];

      for (const testCase of invalidCases) {
        const result = validatePackageNameFormat(testCase.name);
        expect(result).toContain(testCase.expected);
      }
    });

    it('should handle null and non-string inputs', () => {
      expect(validatePackageNameFormat(null as unknown as string)).toContain('Package name must be a non-empty string');
      expect(validatePackageNameFormat(undefined as unknown as string)).toContain('Package name must be a non-empty string');
      expect(validatePackageNameFormat(123 as unknown as string)).toContain('Package name must be a non-empty string');
    });
  });

  describe('checkAllNameConflicts', () => {
    let mockDb: { query: jest.Mock };
    
    beforeEach(() => {
      // getDB is imported at top of file
      mockDb = {
        query: jest.fn()
      };
      (getDB as jest.Mock).mockReturnValue(mockDb);
    });

    it('should return empty array when no names provided', async () => {
      const conflicts = await checkAllNameConflicts([], 'team-1');
      expect(conflicts).toEqual([]);
    });

    it('should detect conflicts in package table', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ name: 'existing-package', team_id: 'n/a' }] }) // exact match
        .mockResolvedValueOnce({ rows: [] }) // like match
        .mockResolvedValueOnce({ rows: [] }) // custom exact
        .mockResolvedValueOnce({ rows: [] }); // custom like

      const conflicts = await checkAllNameConflicts(['existing-package'], 'team-1');
      
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toEqual({
        name: 'existing-package',
        team_id: 'n/a',
        table: 'package'
      });
    });

    it('should detect conflicts in custom_package table from other teams', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // package exact
        .mockResolvedValueOnce({ rows: [] }) // package like
        .mockResolvedValueOnce({ rows: [{ name: 'custom-package', team_id: 'team-2' }] }) // custom exact
        .mockResolvedValueOnce({ rows: [] }); // custom like

      const conflicts = await checkAllNameConflicts(['custom-package'], 'team-1');
      
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toEqual({
        name: 'custom-package',
        team_id: 'team-2',
        table: 'custom_package'
      });
    });

    it('should not detect conflicts with same team packages', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // package exact
        .mockResolvedValueOnce({ rows: [] }) // package like
        .mockResolvedValueOnce({ rows: [] }) // custom exact (same team filtered out)
        .mockResolvedValueOnce({ rows: [] }); // custom like

      const conflicts = await checkAllNameConflicts(['my-package'], 'team-1');
      
      expect(conflicts).toEqual([]);
    });

    it('should detect version-suffixed conflicts using LIKE queries', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // exact match
        .mockResolvedValueOnce({ rows: [{ name: 'test-package-1.0.0', team_id: 'n/a' }] }) // like match found
        .mockResolvedValueOnce({ rows: [] }) // custom exact
        .mockResolvedValueOnce({ rows: [] }); // custom like

      const conflicts = await checkAllNameConflicts(['test-package'], 'team-1');
      
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toEqual({
        name: 'test-package-1.0.0',
        team_id: 'n/a',
        table: 'package'
      });
      
      // Verify LIKE query was called correctly
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('name LIKE $1'),
        ['test-package-%']
      );
    });
  });
});