import { getDB } from "../data/db";
import { getParam } from "../data/param";

export type ExternalScanStatus = "queued" | "running" | "succeeded" | "failed";
export type SBOMStatus = "pending" | "generating" | "succeeded" | "failed";
export type TimePeriod = "1hr" | "4h" | "1d";

export interface ExternalScanCounts {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  total: number;
}

export interface ExternalSBOMCounts {
  pending: number;
  generating: number;
  succeeded: number;
  failed: number;
  total: number;
}

export interface ExternalScanThroughput {
  completed: number;
  avgScanDurationSeconds: number | null;
}

export interface ExternalScanItem {
  digest: string;
  arch: string;
  status: string;
  scanStatusMessage: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  scanAttemptedAt: Date | null;
  scanCompletedAt: Date | null;
  scanStatusUpdatedAt: Date | null;
  registry: string | null;
  imageName: string | null;
  imageTag: string | null;
}

function timePeriodToInterval(timePeriod: TimePeriod): string {
  switch (timePeriod) {
    case "1hr":
      return "1 hour";
    case "4h":
      return "4 hours";
    case "1d":
      return "24 hours";
  }
}

export async function getExternalScanCounts(
  timePeriod: TimePeriod = "1d"
): Promise<ExternalScanCounts> {
  const db = getDB(await getParam("DB_URI"));
  const result = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'queued') AS queued,
      COUNT(*) FILTER (WHERE status = 'running') AS running,
      COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) AS total
    FROM external_image_scan
    WHERE created_at > now() - $1::interval or scan_attempted_at > now() - $1::interval
  `,
    [timePeriodToInterval(timePeriod)]
  );
  const row = result.rows[0];
  return {
    queued: parseInt(row.queued || "0"),
    running: parseInt(row.running || "0"),
    succeeded: parseInt(row.succeeded || "0"),
    failed: parseInt(row.failed || "0"),
    total: parseInt(row.total || "0"),
  };
}

export async function getExternalSBOMCounts(
  timePeriod: TimePeriod = "1d"
): Promise<ExternalSBOMCounts> {
  const db = getDB(await getParam("DB_URI"));
  const result = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'generating') AS generating,
      COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) AS total
    FROM external_image_sbom_status
    WHERE created_at > now() - $1::interval OR status_updated_at > now() - $1::interval
  `,
    [timePeriodToInterval(timePeriod)]
  );
  const row = result.rows[0];
  return {
    pending: parseInt(row.pending || "0"),
    generating: parseInt(row.generating || "0"),
    succeeded: parseInt(row.succeeded || "0"),
    failed: parseInt(row.failed || "0"),
    total: parseInt(row.total || "0"),
  };
}

export async function getExternalScanThroughput(
  timePeriod: TimePeriod = "1d"
): Promise<ExternalScanThroughput> {
  const db = getDB(await getParam("DB_URI"));
  const result = await db.query(
    `SELECT
      COUNT(*) AS completed,
      AVG(
        EXTRACT(EPOCH FROM (scan_completed_at - scan_attempted_at))
      ) FILTER (
        WHERE scan_completed_at IS NOT NULL
          AND scan_attempted_at IS NOT NULL
          AND scan_completed_at > now() - $1::interval
      ) AS avg_scan_duration_seconds
    FROM external_image_scan
    WHERE status = 'succeeded'
      AND scan_completed_at > now() - $1::interval
  `,
    [timePeriodToInterval(timePeriod)]
  );
  const row = result.rows[0];
  return {
    completed: parseInt(row.completed || "0"),
    avgScanDurationSeconds: row.avg_scan_duration_seconds
      ? parseFloat(row.avg_scan_duration_seconds)
      : null,
  };
}

export interface ExternalSBOMStatusItem {
  digest: string;
  status: string;
  statusMessage: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  statusUpdatedAt: Date | null;
  registry: string | null;
  imageName: string | null;
  imageTag: string | null;
}

export async function listExternalSBOMStatuses(
  filters: {
    status?: string;
    timePeriod?: TimePeriod;
    registry?: string;
    image?: string;
    tag?: string;
    digest?: string;
  } = {},
  pagination?: { page?: number; limit?: number }
): Promise<{ statuses: ExternalSBOMStatusItem[]; totalCount: number }> {
  const db = getDB(await getParam("DB_URI"));

  const whereConditions: string[] = [];
  const queryParams: string[] = [];
  let paramIndex = 1;

  if (filters.status) {
    whereConditions.push(`s.status = $${paramIndex}`);
    queryParams.push(filters.status);
    paramIndex++;
  }

  if (filters.timePeriod) {
    whereConditions.push(
      `(s.created_at > now() - $${paramIndex}::interval OR s.status_updated_at > now() - $${paramIndex}::interval)`
    );
    queryParams.push(timePeriodToInterval(filters.timePeriod));
    paramIndex++;
  }

  if (filters.digest) {
    whereConditions.push(`s.digest ILIKE $${paramIndex}`);
    queryParams.push(`%${filters.digest}%`);
    paramIndex++;
  }

  let registryParamIndex: number | null = null;
  let imageParamIndex: number | null = null;
  let tagParamIndex: number | null = null;

  // Build registry/image/tag filter conditions
  const imageTagConditions: string[] = [];

  if (filters.registry) {
    registryParamIndex = paramIndex;
    imageTagConditions.push(`registry ILIKE $${paramIndex}`);
    queryParams.push(`%${filters.registry}%`);
    paramIndex++;
  }

  if (filters.image) {
    imageParamIndex = paramIndex;
    imageTagConditions.push(`image_name ILIKE $${paramIndex}`);
    queryParams.push(`%${filters.image}%`);
    paramIndex++;
  }

  if (filters.tag) {
    tagParamIndex = paramIndex;
    imageTagConditions.push(`image_tag ILIKE $${paramIndex}`);
    queryParams.push(`%${filters.tag}%`);
    paramIndex++;
  }

  if (imageTagConditions.length > 0) {
    whereConditions.push(
      `EXISTS (SELECT 1 FROM external_image_tag WHERE digest = s.digest AND ${imageTagConditions.join(' AND ')})`
    );
  }

  // When filtering by registry/image/tag, prioritize the matching tag row in the lateral
  let lateralOrderBy = "";
  const orderByConditions: string[] = [];

  if (registryParamIndex !== null) {
    orderByConditions.push(`registry ILIKE $${registryParamIndex}`);
  }
  if (imageParamIndex !== null) {
    orderByConditions.push(`image_name ILIKE $${imageParamIndex}`);
  }
  if (tagParamIndex !== null) {
    orderByConditions.push(`image_tag ILIKE $${tagParamIndex}`);
  }

  if (orderByConditions.length > 0) {
    lateralOrderBy = `ORDER BY CASE WHEN ${orderByConditions.join(' AND ')} THEN 0 ELSE 1 END`;
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

  const countResult = await db.query(
    `SELECT COUNT(*) AS total FROM external_image_sbom_status s ${whereClause}`,
    queryParams
  );
  const totalCount = parseInt(countResult.rows[0].total);

  const page = pagination?.page || 1;
  const limit = pagination?.limit || 50;
  const offset = (page - 1) * limit;

  const result = await db.query(
    `
    SELECT
      s.digest,
      s.status,
      s.status_message,
      s.created_at,
      s.updated_at,
      s.status_updated_at,
      t.registry,
      t.image_name,
      t.image_tag
    FROM external_image_sbom_status s
    LEFT JOIN LATERAL (
      SELECT registry, image_name, image_tag
      FROM external_image_tag
      WHERE digest = s.digest
      ${lateralOrderBy}
      LIMIT 1
    ) t ON true
    ${whereClause}
    ORDER BY
      CASE s.status
        WHEN 'generating' THEN 0
        WHEN 'pending' THEN 1
        WHEN 'failed' THEN 2
        ELSE 3
      END,
      s.updated_at DESC NULLS LAST,
      s.digest
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `,
    [...queryParams, String(limit), String(offset)]
  );

  const statuses: ExternalSBOMStatusItem[] = result.rows.map((row: Record<string, unknown>) => ({
    digest: row.digest as string,
    status: row.status as string,
    statusMessage: (row.status_message as string) || null,
    createdAt: row.created_at as Date,
    updatedAt: (row.updated_at as Date) || null,
    statusUpdatedAt: (row.status_updated_at as Date) || null,
    registry: (row.registry as string) || null,
    imageName: (row.image_name as string) || null,
    imageTag: (row.image_tag as string) || null,
  }));

  return { statuses, totalCount };
}

export async function listExternalScans(
  filters: {
    status?: string;
    timePeriod?: TimePeriod;
    registry?: string;
    image?: string;
    tag?: string;
    digest?: string;
  } = {},
  pagination?: { page?: number; limit?: number }
): Promise<{ scans: ExternalScanItem[]; totalCount: number }> {
  const db = getDB(await getParam("DB_URI"));

  const whereConditions: string[] = [];
  const queryParams: string[] = [];
  let paramIndex = 1;

  if (filters.status) {
    whereConditions.push(`s.status = $${paramIndex}`);
    queryParams.push(filters.status);
    paramIndex++;
  }

  if (filters.timePeriod) {
    whereConditions.push(
      `(s.created_at > now() - $${paramIndex}::interval or s.scan_attempted_at > now() - $${paramIndex}::interval)`
    );
    queryParams.push(timePeriodToInterval(filters.timePeriod));
    paramIndex++;
  }

  if (filters.digest) {
    whereConditions.push(`s.digest ILIKE $${paramIndex}`);
    queryParams.push(`%${filters.digest}%`);
    paramIndex++;
  }

  let registryParamIndex: number | null = null;
  let imageParamIndex: number | null = null;
  let tagParamIndex: number | null = null;

  // Build registry/image/tag filter conditions
  const imageTagConditions: string[] = [];

  if (filters.registry) {
    registryParamIndex = paramIndex;
    imageTagConditions.push(`registry ILIKE $${paramIndex}`);
    queryParams.push(`%${filters.registry}%`);
    paramIndex++;
  }

  if (filters.image) {
    imageParamIndex = paramIndex;
    imageTagConditions.push(`image_name ILIKE $${paramIndex}`);
    queryParams.push(`%${filters.image}%`);
    paramIndex++;
  }

  if (filters.tag) {
    tagParamIndex = paramIndex;
    imageTagConditions.push(`image_tag ILIKE $${paramIndex}`);
    queryParams.push(`%${filters.tag}%`);
    paramIndex++;
  }

  if (imageTagConditions.length > 0) {
    whereConditions.push(
      `EXISTS (SELECT 1 FROM external_image_tag WHERE digest = s.digest AND ${imageTagConditions.join(' AND ')})`
    );
  }

  // When filtering by registry/image/tag, prioritize the matching tag row in the lateral so the
  // displayed image name/tag always corresponds to what the user searched for.
  let lateralOrderBy = "";
  const orderByConditions: string[] = [];

  if (registryParamIndex !== null) {
    orderByConditions.push(`registry ILIKE $${registryParamIndex}`);
  }
  if (imageParamIndex !== null) {
    orderByConditions.push(`image_name ILIKE $${imageParamIndex}`);
  }
  if (tagParamIndex !== null) {
    orderByConditions.push(`image_tag ILIKE $${tagParamIndex}`);
  }

  if (orderByConditions.length > 0) {
    lateralOrderBy = `ORDER BY CASE WHEN ${orderByConditions.join(' AND ')} THEN 0 ELSE 1 END`;
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

  const countResult = await db.query(
    `SELECT COUNT(*) AS total FROM external_image_scan s ${whereClause}`,
    queryParams
  );
  const totalCount = parseInt(countResult.rows[0].total);

  const page = pagination?.page || 1;
  const limit = pagination?.limit || 50;
  const offset = (page - 1) * limit;

  const result = await db.query(
    `
    SELECT
      s.digest,
      s.arch,
      s.status,
      s.scan_status_message,
      s.created_at,
      s.updated_at,
      s.scan_attempted_at,
      s.scan_completed_at,
      s.scan_status_updated_at,
      t.registry,
      t.image_name,
      t.image_tag
    FROM external_image_scan s
    LEFT JOIN LATERAL (
      SELECT registry, image_name, image_tag
      FROM external_image_tag
      WHERE digest = s.digest
      ${lateralOrderBy}
      LIMIT 1
    ) t ON true
    ${whereClause}
    ORDER BY
      CASE s.status
        WHEN 'running' THEN 0
        WHEN 'queued' THEN 1
        WHEN 'failed' THEN 2
        ELSE 3
      END,
      s.updated_at DESC NULLS LAST,
      s.digest,
      s.arch
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `,
    [...queryParams, String(limit), String(offset)]
  );

  const scans: ExternalScanItem[] = result.rows.map((row: Record<string, unknown>) => ({
    digest: row.digest as string,
    arch: row.arch as string,
    status: row.status as string,
    scanStatusMessage: (row.scan_status_message as string) || null,
    createdAt: row.created_at as Date,
    updatedAt: (row.updated_at as Date) || null,
    scanAttemptedAt: (row.scan_attempted_at as Date) || null,
    scanCompletedAt: (row.scan_completed_at as Date) || null,
    scanStatusUpdatedAt: (row.scan_status_updated_at as Date) || null,
    registry: (row.registry as string) || null,
    imageName: (row.image_name as string) || null,
    imageTag: (row.image_tag as string) || null,
  }));

  return { scans, totalCount };
}
