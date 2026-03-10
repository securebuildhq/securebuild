import { getDB } from "../data/db";
import { getParam } from "../data/param";

export interface ImageScanResult {
  id: string;
  imageName: string;
  imageTag: string;
  imageArch: string;
  result: any;
  createdAt: Date;
  vulnCountCritical: number;
  vulnCountHigh: number;
  vulnCountMedium: number;
  vulnCountLow: number;
}

export interface ImageScanSummary {
  imageName: string;
  scans: {
    tag: string;
    arch: string;
    vulnerabilities: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    scannedAt: Date;
    scanId: string;
  }[];
}

export async function getImageScanResults(imageName: string): Promise<ImageScanSummary[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    
    // Get recent scans WITHOUT the massive result JSON to avoid memory issues
    // Limit to last 50 scans to prevent memory overflow
    const query = `
      SELECT 
        id,
        image_name,
        image_tag,
        image_arch,
        created_at,
        vuln_count_critical,
        vuln_count_high,
        vuln_count_medium,
        vuln_count_low,
        DATE(created_at) as scan_date
      FROM image_scan 
      WHERE image_name = $1
      ORDER BY created_at DESC
      LIMIT 50
    `;

    const result = await db.query(query, [imageName]);
    
    if (result.rows.length === 0) {
      return [];
    }

    // Group by scan date to create scan runs
    const scansByDate = new Map<string, ImageScanResult[]>();
    
    for (const row of result.rows) {
      const scanDate = row.scan_date;
      if (!scansByDate.has(scanDate)) {
        scansByDate.set(scanDate, []);
      }
      
      scansByDate.get(scanDate)!.push({
        id: row.id,
        imageName: row.image_name,
        imageTag: row.image_tag,
        imageArch: row.image_arch,
        result: null, // Don't load massive JSON result to avoid memory issues
        createdAt: new Date(row.created_at),
        vulnCountCritical: row.vuln_count_critical,
        vulnCountHigh: row.vuln_count_high,
        vulnCountMedium: row.vuln_count_medium,
        vulnCountLow: row.vuln_count_low,
      });
    }

    // Convert to the expected format
    const scanSummaries: ImageScanSummary[] = [];
    
    for (const [scanDate, scans] of scansByDate.entries()) {
      scanSummaries.push({
        imageName,
        scans: scans.map(scan => ({
          tag: scan.imageTag,
          arch: scan.imageArch,
          vulnerabilities: {
            critical: scan.vulnCountCritical,
            high: scan.vulnCountHigh,
            medium: scan.vulnCountMedium,
            low: scan.vulnCountLow,
          },
          scannedAt: scan.createdAt,
          scanId: scan.id,
        })),
      });
    }

    return scanSummaries;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getImageScanResultById(scanId: string): Promise<ImageScanResult | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    
    const query = `
      SELECT 
        id,
        image_name,
        image_tag,
        image_arch,
        result,
        created_at,
        vuln_count_critical,
        vuln_count_high,
        vuln_count_medium,
        vuln_count_low
      FROM image_scan 
      WHERE id = $1
    `;

    const result = await db.query(query, [scanId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      imageName: row.image_name,
      imageTag: row.image_tag,
      imageArch: row.image_arch,
      result: row.result,
      createdAt: new Date(row.created_at),
      vulnCountCritical: row.vuln_count_critical,
      vulnCountHigh: row.vuln_count_high,
      vulnCountMedium: row.vuln_count_medium,
      vulnCountLow: row.vuln_count_low,
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getLatestImageScanResult(imageName: string, imageTag: string, imageArch: string): Promise<ImageScanResult | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    
    const query = `
      SELECT 
        id,
        image_name,
        image_tag,
        image_arch,
        result,
        created_at,
        vuln_count_critical,
        vuln_count_high,
        vuln_count_medium,
        vuln_count_low
      FROM image_scan 
      WHERE image_name = $1 
        AND image_tag = $2 
        AND image_arch = $3
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await db.query(query, [imageName, imageTag, imageArch]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      imageName: row.image_name,
      imageTag: row.image_tag,
      imageArch: row.image_arch,
      result: row.result,
      createdAt: new Date(row.created_at),
      vulnCountCritical: row.vuln_count_critical,
      vulnCountHigh: row.vuln_count_high,
      vulnCountMedium: row.vuln_count_medium,
      vulnCountLow: row.vuln_count_low,
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
}