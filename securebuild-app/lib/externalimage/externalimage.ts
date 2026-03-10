import { getDB } from '../data/db';
import { getParam } from '../data/param';

export interface ExternalImageStats {
  totalImages: number;
  totalTags: number;
  totalDigests: number;
  scannedDigests: number;
  oldestScanAt: string | null;
  sbomDigests: number;
  tagsWithSboms: number;
  tagsWithScans: number;
  unscannedSboms: number;
}

export async function getExternalImageStats(): Promise<ExternalImageStats> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const now = new Date();

    // Combined query for external_image_tag statistics
    const tagStatsResult = await db.query(`
      SELECT
        COUNT(*) as total_tags,
        COUNT(DISTINCT digest) as total_digests
      FROM external_image_tag
    `);

    const totalTags = parseInt(tagStatsResult.rows[0].total_tags);
    const totalDigests = parseInt(tagStatsResult.rows[0].total_digests);

    // Query for oldest security scan date
    const oldestScanResult = await db.query(`
      SELECT MIN(last_security_scanned_at) as oldest_scan_at
      FROM external_image_sbom
      WHERE last_security_scanned_at IS NOT NULL
    `);

    // Helper function to parse UTC timestamp from database
    // Handles both old format (without timezone) and new format (with timezone from PR 778)
    const parseUTCTimestamp = (timestamp: string | Date | null): Date | undefined => {
      if (!timestamp) return undefined;

      // If it's already a Date object, return it
      if (timestamp instanceof Date) {
        return timestamp;
      }

      // PostgreSQL returns timestamps in format '2024-05-17 14:48:00.123456' when cast to text
      // We need to convert this to ISO format for proper UTC parsing
      if (typeof timestamp === 'string' && timestamp.includes(' ') && !timestamp.includes('T')) {
        // Check if timestamp already has timezone info before appending 'Z'
        const hasTimezone = timestamp.includes('+') || timestamp.includes('-', 10);
        if (hasTimezone) {
          // Already has timezone, just replace space with 'T'
          return new Date(timestamp.replace(' ', 'T'));
        } else {
          // No timezone, replace space with 'T' and add 'Z' to indicate UTC
          return new Date(`${timestamp}Z`.replace(' ', 'T'));
        }
      }

      // If the timestamp doesn't end with 'Z' or have timezone info, assume it's UTC
      if (typeof timestamp === 'string' && !timestamp.includes('Z') && !timestamp.includes('+') && !timestamp.includes('-', 10)) {
        return new Date(timestamp + 'Z'); // Add Z to indicate UTC
      }

      return new Date(timestamp);
    };

    // Handle UTC timestamp properly - database timestamps are typically in UTC
    const oldestScanAt = oldestScanResult.rows[0].oldest_scan_at
      ? (() => {
          const parsedDate = parseUTCTimestamp(oldestScanResult.rows[0].oldest_scan_at);
          if (!parsedDate || isNaN(parsedDate.getTime())) {
            console.warn(`Invalid timestamp value for oldest scan: ${oldestScanResult.rows[0].oldest_scan_at}`);
            return null;
          }
          return parsedDate.toISOString();
        })()
      : null;

    // Get remaining stats in parallel
    const [totalImagesResult, scannedDigestsResult, tagsWithScansResult, sbomDigestsResult, tagsWithSbomsResult, unscannedSbomsResult] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM external_image'),
      db.query('SELECT COUNT(DISTINCT digest) as count FROM external_image_scan'),
      db.query(`
        SELECT COUNT(*) as count
        FROM (
          SELECT DISTINCT t.registry, t.image_name, t.image_tag
          FROM external_image_tag t
          INNER JOIN external_image_scan s ON t.digest = s.digest
        ) as distinct_tags
      `),
      db.query('SELECT COUNT(*) as count FROM external_image_sbom'),
      db.query(`
        SELECT COUNT(*) as count
        FROM (
          SELECT DISTINCT t.registry, t.image_name, t.image_tag
          FROM external_image_tag t
          INNER JOIN external_image_sbom s ON t.digest = s.digest
        ) as distinct_tags
      `),
      db.query('SELECT COUNT(*) as count FROM external_image_sbom WHERE last_security_scanned_at IS NULL')
    ]);

    const totalImages = parseInt(totalImagesResult.rows[0].count);
    const scannedDigests = parseInt(scannedDigestsResult.rows[0].count);
    const tagsWithScans = parseInt(tagsWithScansResult.rows[0].count);
    const sbomDigests = parseInt(sbomDigestsResult.rows[0].count);
    const tagsWithSboms = parseInt(tagsWithSbomsResult.rows[0].count);
    const unscannedSboms = parseInt(unscannedSbomsResult.rows[0].count);

    return {
      totalImages,
      totalTags,
      totalDigests,
      scannedDigests,
      oldestScanAt,
      sbomDigests,
      tagsWithSboms,
      tagsWithScans,
      unscannedSboms,
    };
  } catch (err) {
    console.error(`getExternalImageStats error:`, err)
    throw new Error(`Failed to get external image stats: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }
}