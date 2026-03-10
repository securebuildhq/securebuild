import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Creates a temporary pipeline directory for testing.
 * Returns the path to the temporary directory.
 * Caller should clean up with fs.rmSync(dir, { recursive: true, force: true }).
 */
export function setupTestPipelineDir(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-pipelines-'));

  // Create packages and images subdirectories to match the new structure
  const packagesDir = path.join(tmpDir, 'packages');
  const imagesDir = path.join(tmpDir, 'images');
  fs.mkdirSync(packagesDir, { recursive: true });
  fs.mkdirSync(imagesDir, { recursive: true });

  // Create test subdirectory for our silly test pipeline under packages
  const testDir = path.join(packagesDir, 'test');
  fs.mkdirSync(testDir, { recursive: true });

  // Create a silly test pipeline that won't conflict with melange built-ins
  const testPipeline = `name: test-hello
inputs:
  message:
    description: Message to print
    type: string
    default: "hello world from test pipeline"
pipeline:
  - runs: |
      echo "\${{inputs.message}}"
      echo "This is a test pipeline for SecureBuild tests"
`;

  fs.writeFileSync(path.join(testDir, 'hello.yaml'), testPipeline, 'utf8');

  return tmpDir;
}
