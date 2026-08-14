import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/server-session';
import { getAllPipelines } from '@/lib/pipeline/pipeline';
import { createPipelineAction } from '@/lib/pipeline/actions/pipeline-actions';
import { CreatePipelineRequest, PipelineType } from '@/lib/types/pipeline';
import { ValidationError } from '@/lib/errors/validation-error';
import { sanitizePipelinePath } from '@/lib/pipeline/pipeline-utils';
import * as yaml from 'js-yaml';

/**
 * GET /api/v1/pipelines?pipeline_type=package|image
 *
 * Lists all pipelines for a specific type.
 * Requires authentication.
 *
 * Query Parameters:
 * - pipeline_type: 'package' or 'image' (defaults to 'package' until image
 *   pipelines are fully implemented)
 *
 * Response:
 * {
 *   "pipelines": [
 *     {
 *       "id": "id",
 *       "pipeline_type": "package",
 *       "path": "path",
 *       "yaml_content": "yaml configuration...",
 *       "description": "optional description",
 *       "created_at": "2024-01-01T00:00:00Z",
 *       "updated_at": "2024-01-01T00:00:00Z"
 *     }
 *   ]
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // Get and validate session
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid session required' },
        { status: 401 }
      );
    }

    // Get pipeline_type from query parameters
    const url = new URL(request.url);
    const pipelineTypeParam = url.searchParams.get('pipeline_type');
    
    // Validate pipeline_type parameter
    let pipelineType: PipelineType = 'package'; // default
    if (pipelineTypeParam) {
      if (pipelineTypeParam !== 'package' && pipelineTypeParam !== 'image') {
        return NextResponse.json(
          { error: 'Invalid pipeline_type parameter. Must be "package" or "image"' },
          { status: 400 }
        );
      }
      pipelineType = pipelineTypeParam as PipelineType;
    }

    // Get all pipelines for the specified type
    const pipelines = await getAllPipelines(pipelineType);

    return NextResponse.json({ pipelines });

  } catch (error) {
    console.error('Error in pipelines GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/pipelines
 *
 * Creates a new pipeline.
 * Requires authentication.
 *
 * Request body:
 * {
 *   "pipelineType": "package" | "image",
 *   "path": "category/pipeline-name",
 *   "yamlContent": "yaml configuration...",
 *   "description": "optional description"
 * }
 *
 * Response:
 * {
 *   "pipeline": {
 *     "id": "id",
 *     "pipeline_type": "package",
 *     "path": "path",
 *     "yaml_content": "yaml configuration...",
 *     "description": "optional description",
 *     "created_at": "2024-01-01T00:00:00Z",
 *     "updated_at": "2024-01-01T00:00:00Z"
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Get and validate session
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid session required' },
        { status: 401 }
      );
    }

    // Parse request body
    let body: CreatePipelineRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Validate pipelineType
    if (!body.pipelineType) {
      throw new ValidationError('Missing "pipelineType" field - must be "package" or "image"');
    }
    if (body.pipelineType !== 'package' && body.pipelineType !== 'image') {
      throw new ValidationError('Invalid "pipelineType" field - must be "package" or "image"');
    }

    // Validate required fields
    if (!body.path || typeof body.path !== 'string' || body.path.trim().length === 0) {
      throw new ValidationError('Missing or invalid "path" field - must be a non-empty string');
    }

    // Sanitize and validate the path
    const sanitizedPath = sanitizePipelinePath(body.path.trim());
    if (!sanitizedPath) {
      throw new ValidationError('Invalid path: Path contains invalid characters or format. Use alphanumeric characters, hyphens, underscores, and forward slashes only.');
    }

    if (!body.yamlContent || typeof body.yamlContent !== 'string' || body.yamlContent.trim().length === 0) {
      throw new ValidationError('Missing or invalid "yamlContent" field - must be a non-empty string');
    }

    // Validate that yamlContent is valid YAML
    try {
      yaml.load(body.yamlContent);
    } catch (yamlError: any) {
      throw new ValidationError(`Invalid YAML syntax: ${yamlError.message}`);
    }

    // Validate optional description field
    if (body.description !== undefined && (typeof body.description !== 'string' || body.description.trim().length === 0)) {
      throw new ValidationError('Invalid "description" field - must be a non-empty string if provided');
    }

    // Create the pipeline using the action (includes reserved pipeline validation)
    const pipeline = await createPipelineAction({
      pipelineType: body.pipelineType,
      path: sanitizedPath,
      yamlContent: body.yamlContent,
      description: body.description?.trim()
    });

    return NextResponse.json({ pipeline }, { status: 201 });

  } catch (error) {
    // ValidationError indicates a user error (400 Bad Request)
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
