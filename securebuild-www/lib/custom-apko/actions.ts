"use server"

import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { getSession } from "../auth/session";
import { CustomImageBuild, CustomImageBuildStatusType } from "./custom-apko";
import { checkTeamFeatureFlag, FEATURE_FLAGS } from "../auth/feature-flags";
import { traceServerAction } from "@/lib/observability/tracing";

export interface CustomImage {
  id: string;
  name: string;
  default_tag: string;
  readme?: string;
  created_at: Date;
  updated_at: Date;
  apko_count: number;
  latest_build_status?: CustomImageBuildStatusType;
  latest_build_at?: Date;
}

export interface CustomImageDetail {
  id: string;
  name: string;
  default_tag: string;
  readme?: string;
  created_at: Date;
  updated_at: Date;
  apko_configs: Array<{
    id: string;
    name: string;
    tags: string[];
    latest_version_id: string;
    latest_yaml: string;
    created_at: Date;
    updated_at: Date;
    latest_build_status?: CustomImageBuildStatusType;
    latest_build_at?: Date;
  }>;
  all_builds?: CustomImageBuild[];
}

/**
 * Check if the current team has access to custom images feature
 */
export async function hasCustomImages(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.selectedTeamId) {
      return false;
    }

    // Check if the team has the custom-apko-upload feature flag enabled
    return await checkTeamFeatureFlag(session.selectedTeamId, FEATURE_FLAGS.CUSTOM_APKO_UPLOAD);
  } catch (error) {
    console.error('Error checking custom images feature flag:', error);
    return false;
  }
}

/**
 * List custom images for the current team with pagination
 */
async function listCustomImagesImpl(page: number = 1, limit: number = 10): Promise<{
  images: CustomImage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  try {
    const session = await getSession();
    if (!session?.selectedTeamId) {
      throw new Error('No team selected');
    }

    const db = getDB(await getParam("DB_URI"));
    const offset = (page - 1) * limit;

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM custom_image 
      WHERE team_id = $1
    `;
    const countResult = await db.query(countQuery, [session.selectedTeamId]);
    const total = parseInt(countResult.rows[0]?.total || '0');

    // Get paginated results with APKO count and latest build status
    const query = `
      SELECT 
        ci.id,
        ci.name,
        ci.default_tag,
        ci.readme,
        ci.created_at,
        ci.updated_at,
        COUNT(DISTINCT cia.id) as apko_count,
        latest_build.status as latest_build_status,
        latest_build.created_at as latest_build_at
      FROM custom_image ci
      LEFT JOIN custom_image_apko cia ON ci.id = cia.custom_image_id
      LEFT JOIN LATERAL (
        SELECT cib.status, cib.created_at
        FROM custom_image_build cib
        JOIN custom_image_apko_version ciav ON cib.custom_image_apko_version_id = ciav.id
        JOIN custom_image_apko cia2 ON ciav.custom_image_apko_id = cia2.id
        WHERE cia2.custom_image_id = ci.id
        ORDER BY cib.created_at DESC
        LIMIT 1
      ) latest_build ON true
      WHERE ci.team_id = $1
      GROUP BY ci.id, ci.name, ci.default_tag, ci.readme, ci.created_at, ci.updated_at, 
               latest_build.status, latest_build.created_at
      ORDER BY ci.updated_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await db.query(query, [session.selectedTeamId, limit, offset]);

    const images: CustomImage[] = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      default_tag: row.default_tag,
      readme: row.readme,
      created_at: row.created_at,
      updated_at: row.updated_at,
      apko_count: parseInt(row.apko_count || '0'),
      latest_build_status: row.latest_build_status as CustomImageBuildStatusType,
      latest_build_at: row.latest_build_at
    }));

    return {
      images,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  } catch (error) {
    console.error('Error listing custom images:', error);
    throw error;
  }
}

export const listCustomImages = traceServerAction('listCustomImages', listCustomImagesImpl);

/**
 * Get detailed information about a custom image including APKO configs
 */
async function getCustomImageDetailImpl(customImageId: string): Promise<CustomImageDetail | null> {
  try {
    const session = await getSession();
    if (!session?.selectedTeamId) {
      throw new Error('No team selected');
    }

    const db = getDB(await getParam("DB_URI"));

    // Get custom image with APKO configurations and build status
    const query = `
      SELECT 
        ci.id,
        ci.name,
        ci.default_tag,
        ci.readme,
        ci.created_at as image_created_at,
        ci.updated_at as image_updated_at,
        cia.id as apko_id,
        cia.name as apko_name,
        cia.tags as apko_tags,
        cia.created_at as apko_created_at,
        cia.updated_at as apko_updated_at,
        ciav.id as version_id,
        ciav.apko_yaml,
        latest_build.status as latest_build_status,
        latest_build.created_at as latest_build_at
      FROM custom_image ci
      LEFT JOIN custom_image_apko cia ON ci.id = cia.custom_image_id
      LEFT JOIN custom_image_apko_version ciav ON cia.id = ciav.custom_image_apko_id
      LEFT JOIN LATERAL (
        SELECT cib.status, cib.created_at
        FROM custom_image_build cib
        WHERE cib.custom_image_apko_version_id = ciav.id
        ORDER BY cib.created_at DESC
        LIMIT 1
      ) latest_build ON true
      WHERE ci.id = $1 AND ci.team_id = $2
      ORDER BY cia.created_at DESC, ciav.created_at DESC
    `;
    const result = await db.query(query, [customImageId, session.selectedTeamId]);

    if (result.rows.length === 0) {
      return null;
    }

    const firstRow = result.rows[0];
    const image: CustomImageDetail = {
      id: firstRow.id,
      name: firstRow.name,
      default_tag: firstRow.default_tag,
      readme: firstRow.readme,
      created_at: firstRow.image_created_at,
      updated_at: firstRow.image_updated_at,
      apko_configs: []
    };

    // Group APKO configs and get latest version for each
    const apkoMap = new Map();
    for (const row of result.rows) {
      if (row.apko_id && !apkoMap.has(row.apko_id)) {
        apkoMap.set(row.apko_id, {
          id: row.apko_id,
          name: row.apko_name,
          tags: row.apko_tags || [],
          latest_version_id: row.version_id,
          latest_yaml: row.apko_yaml,
          created_at: row.apko_created_at,
          updated_at: row.apko_updated_at,
          latest_build_status: row.latest_build_status as CustomImageBuildStatusType,
          latest_build_at: row.latest_build_at
        });
      }
    }

    image.apko_configs = Array.from(apkoMap.values());
    return image;
  } catch (error) {
    console.error('Error getting custom image detail:', error);
    throw error;
  }
}

export const getCustomImageDetail = traceServerAction('getCustomImageDetail', getCustomImageDetailImpl);

/**
 * Get all builds for a custom image with pagination
 */
async function getCustomImageBuildsImpl(customImageId: string, page: number = 1, limit: number = 10): Promise<{
  builds: CustomImageBuild[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  try {
    const session = await getSession();
    if (!session?.selectedTeamId) {
      throw new Error('No team selected');
    }

    const db = getDB(await getParam("DB_URI"));
    const offset = (page - 1) * limit;

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM custom_image_build cib
      JOIN custom_image_apko_version ciav ON cib.custom_image_apko_version_id = ciav.id
      JOIN custom_image_apko cia ON ciav.custom_image_apko_id = cia.id
      JOIN custom_image ci ON cia.custom_image_id = ci.id
      WHERE ci.id = $1 AND ci.team_id = $2
    `;
    const countResult = await db.query(countQuery, [customImageId, session.selectedTeamId]);
    const total = parseInt(countResult.rows[0]?.total || '0');

    // Get paginated builds with APKO config name for context
    const query = `
      SELECT 
        cib.id,
        cib.custom_image_apko_version_id,
        cib.team_id,
        cib.status,
        cib.created_at,
        cib.timeout_at,
        cib.builder_id,
        cib.build_started_at,
        cib.build_finished_at,
        cib.apko_stdout,
        cib.apko_stderr,
        cib.grype_aarch64_stderr,
        cib.grype_x86_64_stderr,
        cib.builder_stdout,
        cib.worker_error,
        cia.name as apko_name,
        cia.tags as apko_tags
      FROM custom_image_build cib
      JOIN custom_image_apko_version ciav ON cib.custom_image_apko_version_id = ciav.id
      JOIN custom_image_apko cia ON ciav.custom_image_apko_id = cia.id
      JOIN custom_image ci ON cia.custom_image_id = ci.id
      WHERE ci.id = $1 AND ci.team_id = $2
      ORDER BY cib.created_at DESC
      LIMIT $3 OFFSET $4
    `;
    const result = await db.query(query, [customImageId, session.selectedTeamId, limit, offset]);

    const builds: CustomImageBuild[] = result.rows.map(row => ({
      id: row.id,
      custom_image_apko_version_id: row.custom_image_apko_version_id,
      team_id: row.team_id,
      status: row.status as CustomImageBuildStatusType,
      created_at: row.created_at,
      timeout_at: row.timeout_at,
      builder_id: row.builder_id,
      build_started_at: row.build_started_at,
      build_finished_at: row.build_finished_at,
      apko_stdout: row.apko_stdout,
      apko_stderr: row.apko_stderr,
      grype_aarch64_stderr: row.grype_aarch64_stderr,
      grype_x86_64_stderr: row.grype_x86_64_stderr,
      builder_stdout: row.builder_stdout,
      worker_error: row.worker_error
    }));

    return {
      builds,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  } catch (error) {
    console.error('Error getting custom image builds:', error);
    throw error;
  }
}

export const getCustomImageBuilds = traceServerAction('getCustomImageBuilds', getCustomImageBuildsImpl);