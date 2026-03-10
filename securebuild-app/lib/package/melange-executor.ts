import { exec } from 'child_process';
import { promisify } from 'util';
import { MelangeConfig } from './provides';

const execAsync = promisify(exec);

/**
 * Execute melange compile command and return the compiled configuration
 * This is a thin wrapper around the melange CLI that can be easily mocked in tests
 */
export async function executeMelangeCompile(
  melangeYamlPath: string,
  pipelineDir: string
): Promise<MelangeConfig> {
  const { stdout } = await execAsync(
    `melange compile --arch aarch64 --arch x86_64 --pipeline-dir ${pipelineDir} ${melangeYamlPath}`,
    {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    }
  );

  // Parse the compiled YAML output
  const compiled = JSON.parse(stdout) as MelangeConfig;
  return compiled;
}

