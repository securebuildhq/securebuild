import { CreatePipelineRequest, UpdatePipelineRequest, PipelineType } from "../types/pipeline";
import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { enqueueWork } from "../utils/queue";
import { ValidationError } from "../errors/validation-error";
import { randomBytes } from "crypto";

// Re-export client-safe yaml utils for convenience
export { extractPipelineNameFromYAML } from "./pipeline-utils";

/**
 * Pipeline represents a pipeline configuration (database format with snake_case)
 */
export interface PipelineDB {
  id: string;
  pipeline_type: PipelineType; // 'package' or 'image'
  path: string;
  yaml_content: string;
  description?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Get all pipelines from the database for a specific pipeline type
 */
export async function getAllPipelines(pipelineType: PipelineType = 'package'): Promise<PipelineDB[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Query unified pipeline table with pipeline_type filter
    const query = `
      SELECT id, pipeline_type, path, yaml_content, description, created_at, updated_at
      FROM pipeline
      WHERE pipeline_type = $1
      ORDER BY created_at DESC
    `;

    const result = await db.query(query, [pipelineType]);

    return result.rows.map(row => ({
      id: row.id,
      pipeline_type: row.pipeline_type,
      path: row.path,
      yaml_content: row.yaml_content,
      description: row.description || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  } catch (error) {
    console.error('Error getting all pipelines:', error);
    throw error;
  }
}

/**
 * Get a specific pipeline by pipeline type and path
 */
export async function getPipeline(path: string, pipelineType: PipelineType = 'package'): Promise<PipelineDB> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Query unified pipeline table with pipeline_type and path filter
    const query = `
      SELECT id, pipeline_type, path, yaml_content, description, created_at, updated_at
      FROM pipeline
      WHERE pipeline_type = $1 AND path = $2
    `;

    const result = await db.query(query, [pipelineType, path]);

    if (result.rows.length === 0) {
      throw new ValidationError(`Pipeline not found: ${path}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      pipeline_type: row.pipeline_type,
      path: row.path,
      yaml_content: row.yaml_content,
      description: row.description || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  } catch (error) {
    console.error('Error getting pipeline:', error);
    throw error;
  }
}

/**
 * Create a new pipeline
 */
export async function createPipeline(pipeline: CreatePipelineRequest): Promise<PipelineDB> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Generate a random ID using crypto (32 hex characters, same as Go securerandom.Hex(16))
    const id = randomBytes(16).toString('hex');
    const now = new Date();

    // Insert into unified pipeline table with pipeline_type
    const query = `
      INSERT INTO pipeline (id, pipeline_type, path, yaml_content, description, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, pipeline_type, path, yaml_content, description, created_at, updated_at
    `;

    const result = await db.query(query, [
      id,
      pipeline.pipelineType,
      pipeline.path,
      pipeline.yamlContent,
      pipeline.description || null,
      now,
      now
    ]);

    const row = result.rows[0];
    const createdPipeline = {
      id: row.id,
      pipeline_type: row.pipeline_type,
      path: row.path,
      yaml_content: row.yaml_content,
      description: row.description || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at
    };

    // Trigger pipeline sync to local directory and GitHub
    try {
      await enqueueWork("pipeline_sync", {
        path: pipeline.path,
        operation: "create",
        type: pipeline.pipelineType
      });
    } catch (syncErr) {
      console.warn("Failed to enqueue pipeline_sync after pipeline creation:", syncErr);
    }

    return createdPipeline;
  } catch (error: any) {
    // Check for unique constraint violation (PostgreSQL error code 23505)
    if (error.code === '23505') {
      throw new ValidationError(`A pipeline with the path "${pipeline.path}" already exists. Please choose a different path.`);
    }
    console.error('Error creating pipeline:', error);
    throw error;
  }
}

/**
 * Update an existing pipeline by path and pipeline type
 * If the path changes, the old pipeline file is removed via pipeline_sync
 */
export async function updatePipeline(path: string, updates: UpdatePipelineRequest, pipelineType: PipelineType = 'package'): Promise<PipelineDB | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const now = new Date();

    // Update unified pipeline table using pipeline_type and path as identifier
    const query = `
      UPDATE pipeline
      SET path = $1, yaml_content = $2, description = $3, updated_at = $4
      WHERE pipeline_type = $5 AND path = $6
      RETURNING id, pipeline_type, path, yaml_content, description, created_at, updated_at
    `;

    const result = await db.query(query, [
      updates.path,
      updates.yamlContent,
      updates.description || null,
      now,
      pipelineType,
      path
    ]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const updatedPipeline = {
      id: row.id,
      pipeline_type: row.pipeline_type,
      path: row.path,
      yaml_content: row.yaml_content,
      description: row.description || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at
    };

    // Trigger pipeline sync to local directory and GitHub
    // If path changed, pipeline_sync worker will handle cleanup of old file
    try {
      await enqueueWork("pipeline_sync", {
        path: updates.path,
        oldPath: path,
        operation: "update",
        type: pipelineType
      });
    } catch (syncErr) {
      console.warn("Failed to enqueue pipeline_sync after pipeline update:", syncErr);
    }

    return updatedPipeline;
  } catch (error: any) {
    // Check for unique constraint violation (PostgreSQL error code 23505)
    if (error.code === '23505') {
      throw new ValidationError(`A pipeline with the path "${updates.path}" already exists. Please choose a different path.`);
    }
    console.error('Error updating pipeline:', error);
    throw error;
  }
}

/**
 * Delete a pipeline by path and pipeline type
 */
export async function deletePipeline(path: string, pipelineType: PipelineType = 'package'): Promise<boolean> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Delete from unified pipeline table using pipeline_type and path
    const query = `DELETE FROM pipeline WHERE pipeline_type = $1 AND path = $2`;

    const result = await db.query(query, [pipelineType, path]);

    const deleted = (result.rowCount || 0) > 0;

    // Trigger pipeline sync to remove from local directory and GitHub
    if (deleted) {
      try {
        await enqueueWork("pipeline_sync", {
          path,
          operation: "delete",
          type: pipelineType
        });
      } catch (syncErr) {
        console.warn("Failed to enqueue pipeline_sync after pipeline deletion:", syncErr);
      }
    }

    return deleted;
  } catch (error) {
    console.error('Error deleting pipeline:', error);
    throw error;
  }
}
