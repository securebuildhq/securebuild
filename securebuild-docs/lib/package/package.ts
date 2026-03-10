import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { logger } from "../utils/logger";

export interface PackageCount {
  total: number;
  x86_64: number;
  aarch64: number;
}

/**
 * Get the count of packages in the APK catalog by architecture
 * This demonstrates the pattern: server actions call library functions, not the DB directly
 */
export async function getPackageCount(): Promise<PackageCount> {
  logger.debug("getting package count from apk_catalog");

  try {
    const db = getDB(await getParam("DB_URI"));

    // Get total count of unique packages (distinct by package name)
    const totalQuery = `
      SELECT COUNT(DISTINCT (index_content::json ->> 'pkgname')) as count
      FROM apk_catalog
      WHERE is_withdrawn = false
    `;

    // Get count by architecture
    const archQuery = `
      SELECT
        arch,
        COUNT(DISTINCT (index_content::json ->> 'pkgname')) as count
      FROM apk_catalog
      WHERE is_withdrawn = false
      GROUP BY arch
    `;

    const [totalResult, archResult] = await Promise.all([
      db.query(totalQuery),
      db.query(archQuery)
    ]);

    const total = parseInt(totalResult.rows[0].count) || 0;

    // Parse architecture-specific counts
    let x86_64 = 0;
    let aarch64 = 0;

    for (const row of archResult.rows) {
      const count = parseInt(row.count) || 0;
      if (row.arch === 'x86_64') {
        x86_64 = count;
      } else if (row.arch === 'aarch64') {
        aarch64 = count;
      }
    }

    const result = {
      total,
      x86_64,
      aarch64
    };

    logger.debug("package count result", result);
    return result;

  } catch (error) {
    logger.error("Failed to get package count", error);
    throw error;
  }
}

/**
 * Get a formatted package count string for display
 */
export async function getFormattedPackageCount(): Promise<string> {
  try {
    const count = await getPackageCount();

    if (count.total === 0) {
      return "packages";
    }

    // Format with commas for readability
    const formattedTotal = count.total.toLocaleString();

    if (count.total > 1000) {
      return `over ${Math.floor(count.total / 1000) * 1000} APK packages`;
    }

    return `${formattedTotal} APK packages`;
  } catch (error) {
    logger.error("Failed to get formatted package count", error);
    // Fallback to static text if database is unavailable
    return "over 2,000 APK packages";
  }
}
