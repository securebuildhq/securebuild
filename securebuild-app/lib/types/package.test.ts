import { AdditionalFile } from './package';
import { archiveAndEncodeAdditionalFiles, decodeAndExtractAdditionalFiles } from '@/lib/package/tar';

describe('Additional Files Archive', () => {
  test('should correctly archive and extract files', async () => {
    // Create test files
    const testFiles: AdditionalFile[] = [
      {
        id: 'file1',
        path: 'test/file1.txt',
        content: 'This is file 1 content',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01')
      },
      {
        id: 'file2',
        path: 'test/nested/file2.txt',
        content: 'This is file 2 content\nwith multiple lines\nand special chars: !@#$%^&*()',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01')
      },
      {
        id: 'empty',
        path: 'test/empty.txt',
        content: '',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01')
      },
      {
        id: 'special',
        path: 'test/special !@#$%^&*()/path with spaces/file.txt',
        content: 'Content in path with special chars',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01')
      }
    ];

    // Archive files
    const archive = await archiveAndEncodeAdditionalFiles(testFiles);
    expect(archive).toBeDefined();
    expect(archive?.filename).toBe('additional-files.tar.gz');
    expect(typeof archive?.data).toBe('string');
    expect(archive?.data.length).toBeGreaterThan(0);

    // Extract files
    const extractedFiles = await decodeAndExtractAdditionalFiles(archive!);
    expect(extractedFiles).toHaveLength(testFiles.length);

    // Compare files
    for (const originalFile of testFiles) {
      const extractedFile = extractedFiles.find((f: AdditionalFile) => f.path === originalFile.path);
      expect(extractedFile).toBeDefined();
      expect(extractedFile?.content).toBe(originalFile.content);
    }
  });
});
