"use server"

import { Session } from "@/lib/types/session";
import { Package } from "@/lib/types/package";
import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";

export interface DashboardStats {
  totalPackages: number;
  successfulPackages: number;
  successRate: number;
  packagesWithBuilds: number;
  failedPackages: number;
  packagesWithExternalDependencies: number;
  failedBreakdown: {
    failed: number;
    timedOut: number;
    stalled: number;
    vmDeleted: number;
  };
}

export interface FailingPackagesResult {
  packages: Package[];
  totalCount: number;
  totalPages: number;
}

export async function getDashboardStatsAction(sess: Session): Promise<DashboardStats> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Get total package count
    const totalCountQuery = `
      SELECT COUNT(*) as total_count
      FROM package p
      WHERE p.parent_id IS NULL
    `;
    const totalResult = await db.query(totalCountQuery);
    const totalPackages = parseInt(totalResult.rows[0].total_count);

    // Get package build status counts
    const statusCountsQuery = `
      WITH package_latest_builds AS (
        SELECT DISTINCT ON (p.id)
          p.id,
          p.name,
          e.status,
          e.created_at
        FROM package p
        LEFT JOIN package_version pv ON pv.package_id = p.id
        LEFT JOIN execution e ON e.package_id = p.id AND e.version_label = pv.version
        WHERE p.parent_id IS NULL
        ORDER BY p.id, e.created_at DESC
      )
      SELECT
        status,
        COUNT(*) as count
      FROM package_latest_builds
      WHERE status IS NOT NULL
      GROUP BY status
    `;

    const statusResult = await db.query(statusCountsQuery);

    let successfulPackages = 0;
    let failedBreakdown = {
      failed: 0,
      timedOut: 0,
      stalled: 0,
      vmDeleted: 0
    };
    let packagesWithBuilds = 0;

    statusResult.rows.forEach(row => {
      const count = parseInt(row.count);
      packagesWithBuilds += count;

      switch (row.status?.toLowerCase()) {
        case 'success':
          successfulPackages = count;
          break;
        case 'failed':
          failedBreakdown.failed = count;
          break;
        case 'timed_out':
          failedBreakdown.timedOut = count;
          break;
        case 'stalled':
          failedBreakdown.stalled = count;
          break;
        case 'vm_deleted':
          failedBreakdown.vmDeleted = count;
          break;
      }
    });

    const failedPackages = failedBreakdown.failed + failedBreakdown.timedOut +
                          failedBreakdown.stalled + failedBreakdown.vmDeleted;

    const successRate = packagesWithBuilds > 0 ?
                       Math.round((successfulPackages / packagesWithBuilds) * 100) : 0;

    // Get packages with external dependencies count
    const externalDepsQuery = `
      SELECT COUNT(DISTINCT p.id) as external_deps_count
      FROM package p
      INNER JOIN package_version pv ON pv.package_id = p.id
      WHERE p.parent_id IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM package_version_dependency_buildtime pvdb
            WHERE pvdb.package_version_id = pv.id
              AND pvdb.depends_on_package_is_external = true  
          )
          OR EXISTS (
            SELECT 1 FROM package_version_dependency_runtime pvdr
            WHERE pvdr.package_version_id = pv.id
              AND pvdr.depends_on_package_is_external = true
          )
        )
    `;

    const externalDepsResult = await db.query(externalDepsQuery);
    const packagesWithExternalDependencies = parseInt(externalDepsResult.rows[0].external_deps_count || 0);

    return {
      totalPackages,
      successfulPackages,
      successRate,
      packagesWithBuilds,
      failedPackages,
      packagesWithExternalDependencies,
      failedBreakdown
    };
  } catch (error) {
    console.error("Failed to get dashboard stats:", error);
    throw error;
  }
}

export async function getFailingPackagesAction(
  sess: Session,
  page: number = 1,
  limit: number = 10
): Promise<FailingPackagesResult> {
  try {
    // Validate pagination
    if (!Number.isInteger(page) || page < 1) {
      throw new Error("Page must be a positive integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Limit must be a positive integer between 1 and 100");
    }

    const db = getDB(await getParam("DB_URI"));

    // Get total count of failing packages
    const totalCountQuery = `
      WITH package_latest_builds AS (
        SELECT DISTINCT ON (p.id)
          p.id,
          e.status
        FROM package p
        LEFT JOIN package_version pv ON pv.package_id = p.id
        LEFT JOIN execution e ON e.package_id = p.id AND e.version_label = pv.version
        WHERE p.parent_id IS NULL
        ORDER BY p.id, e.created_at DESC
      )
      SELECT COUNT(*) as total_count
      FROM package_latest_builds
      WHERE status IN ('failed', 'timed_out', 'stalled', 'vm_deleted')
    `;

    const totalResult = await db.query(totalCountQuery);
    const totalCount = parseInt(totalResult.rows[0].total_count);
    const totalPages = Math.ceil(totalCount / limit);

    // Get paginated failing packages
    const offset = (page - 1) * limit;
    const packagesQuery = `
      WITH package_latest_builds AS (
        SELECT DISTINCT ON (p.id)
          p.id,
          p.name,
          p.created_at,
          p.updated_at,
          pv.version as last_version,
          pv.apk_release as last_apk_release,
          e.status as last_build_status,
          e.created_at as last_build_time
        FROM package p
        LEFT JOIN package_version pv ON pv.package_id = p.id
        LEFT JOIN execution e ON e.package_id = p.id AND e.version_label = pv.version
        WHERE p.parent_id IS NULL
        ORDER BY p.id, e.created_at DESC
      )
      SELECT *
      FROM package_latest_builds
      WHERE last_build_status IN ('failed', 'timed_out', 'stalled', 'vm_deleted')
      ORDER BY last_build_time DESC
      LIMIT $1 OFFSET $2
    `;

    const packagesResult = await db.query(packagesQuery, [limit, offset]);

    const packages: Package[] = packagesResult.rows.map(row => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      subpackages: [],
      lastVersion: row.last_version || "",
      lastAPKRelease: row.last_apk_release || 0,
      versionLabels: [],
      lastBuildTime: row.last_build_time,
      lastBuildStatus: row.last_build_status
    }));

    return {
      packages,
      totalCount,
      totalPages
    };
  } catch (error) {
    console.error("Failed to get failing packages:", error);
    throw error;
  }
}
