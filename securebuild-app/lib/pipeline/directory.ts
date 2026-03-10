
import { getParam } from '@/lib/data/param';
import { join } from 'path';

export type PipelineType = 'package' | 'image';

/**
 * Get the pipeline directory path for the specified pipeline type.
 * This should match the logic in pkg/pipeline/pipeline.go GetPipelineDir(ctx, pipelineType)
 *
 * @param pipelineType - The type of pipeline ('package' or 'image')
 * @returns Promise<string> - The full path to the pipeline directory
 * @throws Error if PIPELINE_DIR is not set or pipelineType is invalid
 */
export async function getPipelineDirectory(pipelineType: PipelineType): Promise<string> {
  const pipelineRootDir = await getParam('PIPELINE_DIR');
  if (!pipelineRootDir) {
    throw new Error('PIPELINE_DIR is not set in param system (Doppler/environment variable)');
  }

  let subdir: string;
  switch (pipelineType) {
    case 'package':
      subdir = 'packages';
      break;
    case 'image':
      subdir = 'images';
      break;
    default:
      throw new Error(`Unknown pipeline type: ${pipelineType}`);
  }

  return join(pipelineRootDir, subdir);
}
