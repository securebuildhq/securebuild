"use server"

import { Pipeline, CreatePipelineRequest, UpdatePipelineRequest } from "@/lib/types/pipeline";
import { Session } from "@/lib/types/session";
import {
  getAllPipelines,
  createPipeline as createPipelineDB,
  updatePipeline as updatePipelineDB,
  deletePipeline as deletePipelineDB,
  type PipelineDB
} from "@/lib/pipeline/pipeline";
import { PipelineType } from "@/lib/types/pipeline";
import { isReservedPipeline } from "@/lib/pipeline/reserved-pipelines";
import { ValidationError } from "@/lib/errors/validation-error";
import { validatePipelinePath, validatePipelineInputNames } from "@/lib/pipeline/pipeline-utils";

// Helper to convert DB pipeline to client Pipeline type
function convertPipeline(dbPipeline: PipelineDB): Pipeline {
  return {
    id: dbPipeline.id,
    pipelineType: dbPipeline.pipeline_type as 'package' | 'image',
    path: dbPipeline.path,
    yamlContent: dbPipeline.yaml_content,
    description: dbPipeline.description,
    createdAt: dbPipeline.created_at,
    updatedAt: dbPipeline.updated_at,
  };
}

export async function listPipelinesAction(sess: Session, pipelineType: PipelineType = 'package'): Promise<Pipeline[]> {
  const dbPipelines = await getAllPipelines(pipelineType);
  return dbPipelines.map(convertPipeline);
}


export async function createPipelineAction(
  sess: Session,
  request: CreatePipelineRequest
): Promise<Pipeline> {
  // Sanitize and validate the path
  const sanitizedPath = validatePipelinePath(request.path);

  // Validate pipeline input names
  validatePipelineInputNames(request.yamlContent);

  // Validate that the pipeline path is not reserved by melange (only applies to package pipelines)
  if (request.pipelineType === 'package' && await isReservedPipeline(sanitizedPath)) {
    throw new ValidationError(`Pipeline ${sanitizedPath} is reserved by melange and cannot be overridden`);
  }

  const dbPipeline = await createPipelineDB({
    ...request,
    path: sanitizedPath
  });
  return convertPipeline(dbPipeline);
}

export async function updatePipelineAction(
  sess: Session,
  path: string,
  request: UpdatePipelineRequest,
  pipelineType: PipelineType = 'package'
): Promise<Pipeline> {
  // Sanitize and validate the updated path
  const sanitizedPath = validatePipelinePath(request.path);

  // Validate pipeline input names
  validatePipelineInputNames(request.yamlContent);

  // Validate that the updated pipeline path is not reserved by melange (only applies to package pipelines)
  if (pipelineType === 'package' && await isReservedPipeline(sanitizedPath)) {
    throw new ValidationError(`Pipeline ${sanitizedPath} is reserved by melange and cannot be overridden`);
  }

  const dbPipeline = await updatePipelineDB(path, {
    ...request,
    path: sanitizedPath
  }, pipelineType);

  if (!dbPipeline) {
    throw new ValidationError(`Pipeline not found: ${path}`);
  }

  return convertPipeline(dbPipeline);
}

export async function deletePipelineAction(sess: Session, path: string, pipelineType: PipelineType = 'package'): Promise<void> {
  const deleted = await deletePipelineDB(path, pipelineType);

  if (!deleted) {
    throw new ValidationError(`Pipeline not found: ${path}`);
  }
}
