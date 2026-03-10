"use server"

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { ValidationError } from '@/lib/errors/validation-error';
import { logger } from '@/lib/utils/logger';
import { getPipelineDirectory } from '@/lib/pipeline/directory';
import { constants } from 'node:fs';

const execFileAsync = promisify(execFile);

// Cache melange availability check
let isMelangeAvailable: boolean | null = null;

export async function checkMelangeAvailable(): Promise<boolean> {
  if (isMelangeAvailable !== null) {
    return isMelangeAvailable;
  }

  try {
    await execFileAsync('melange', ['version']);
    isMelangeAvailable = true;
  } catch (error) {
    isMelangeAvailable = false;
    logger.warn('Melange not found, YAML validation will be disabled');
  }

  return isMelangeAvailable;
}

export async function validateMelangeYAML(yaml: string): Promise<void> {
  let tmpDir: string | null = null;

  try {
    // Create a temporary directory for validation
    tmpDir = join(tmpdir(), `melange-validation-${randomBytes(8).toString('hex')}`)
    await mkdir(tmpDir, { recursive: true })

    // Write the melange YAML file
    const tmpPath = join(tmpDir, 'melange.yaml')
    await writeFile(tmpPath, yaml)

    // Get the persistent pipeline directory for package pipelines
    // Pipelines are already synced to this directory by the pipeline_sync listener
    const pipelinesDir = await getPipelineDirectory('package')

    // Verify pipeline directory exists and is readable
    try {
      await access(pipelinesDir, constants.R_OK)
    } catch (error) {
      throw new ValidationError(`Pipeline directory does not exist or is not readable: ${pipelinesDir}`)
    }

    // Run melange compile with --pipeline-dir pointing to persistent directory
    try {
      await execFileAsync('melange', ['compile', 'melange.yaml', '--arch', 'x86_64', '--pipeline-dir', pipelinesDir, '--log-level', 'error'], {
        cwd: tmpDir
      })
    } catch (error: any) {
      logger.error('Melange compile failed', {
        stderr: error.stderr,
        stdout: error.stdout,
        message: error.message
      })
      throw new ValidationError(error.stderr || error.message || 'Invalid melange YAML')
    }
  } finally {
    // Clean up temp directory
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
