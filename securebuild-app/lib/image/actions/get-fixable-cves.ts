"use server";

import { getParam } from "../../data/param";
import { getDB } from "../../data/db";

export interface FixableCVE {
  artifactName: string;
  artifactVersion: string;
  fixVersions: string[];
  artifactType: string;
  cveId: string;
  dataSource: string | null;
  severity: string;
  epssPercentile: number | null;
  riskScore: number | null;
  arch: string;
}

export interface FixableCVEsByAPKO {
  apkoId: string;
  tags: string[];
  vulnerabilities: FixableCVE[];
}

// Helper function to extract version parts
function extractVersion(v: string): string {
  // Example: "3.11.14-r1" -> "3.11.14"
  return v.split('-')[0];
}

// Helper function to bulk fetch scan results from image_scan table
async function bulkFetchScanResults(
  scanKeys: Array<{ imageName: string; tag: string; arch: string }>
): Promise<Map<string, any>> {
  if (scanKeys.length === 0) {
    return new Map();
  }

  const db = getDB(await getParam("DB_URI"));

  // Build WHERE clause with OR conditions for each tuple
  const conditions = scanKeys.map((_, i) =>
    `(image_name = $${i * 3 + 1} AND image_tag = $${i * 3 + 2} AND image_arch = $${i * 3 + 3})`
  ).join(' OR ');

  const scanQuery = `
    WITH latest_scans AS (
      SELECT DISTINCT ON (image_name, image_tag, image_arch)
        image_name,
        image_tag,
        image_arch,
        result
      FROM image_scan
      WHERE ${conditions}
      ORDER BY image_name, image_tag, image_arch, created_at DESC
    )
    SELECT * FROM latest_scans
  `;

  // Flatten all parameters in order
  const params = scanKeys.flatMap(k => [k.imageName, k.tag, k.arch]);

  const scanResult = await db.query(scanQuery, params);

  // Index scan results by (imageName, tag, arch)
  const scanResultIndex = new Map<string, any>();
  for (const row of scanResult.rows) {
    const key = `${row.image_name}|${row.image_tag}|${row.image_arch}`;
    scanResultIndex.set(key, row.result);
  }

  return scanResultIndex;
}

// Helper function to check if a string looks like a valid semver
function isValidSemver(version: string): boolean {
  const extracted = extractVersion(version);
  const parts = extracted.split('.');
  // Valid semver has at least major.minor (two numeric parts)
  return parts.length >= 2 && parts.slice(0, 2).every(p => /^\d+$/.test(p));
}

export async function getFixableCVEs(imageName: string, imageId: string): Promise<FixableCVEsByAPKO[]> {
  const ociImagePrefix = await getParam("OCI_IMAGE_PREFIX");
  const registryImagePrefix = await getParam("REGISTRY_IMAGE_PREFIX");
  const prefix = ociImagePrefix || registryImagePrefix;
  const fullImageName = `${prefix}/${imageName}`;

  // Get APKOs with their tags for this image
  const db = getDB(await getParam("DB_URI"));
  const apkoQuery = `
    SELECT id, tags
    FROM image_apko
    WHERE image_id = $1
    ORDER BY created_at
  `;
  const apkoResult = await db.query(apkoQuery, [imageId]);

  const result: FixableCVEsByAPKO[] = [];

  // Build list of all (imageName, tag, arch) tuples we need to fetch
  const scanKeys: Array<{ imageName: string; tag: string; arch: string }> = [];
  for (const apkoRow of apkoResult.rows) {
    const tags = apkoRow.tags || [];
    for (const tag of tags) {
      scanKeys.push({ imageName: fullImageName, tag, arch: "x86_64" });
      scanKeys.push({ imageName: fullImageName, tag, arch: "aarch64" });
    }
  }

  // Bulk fetch all scan results
  const scanResultIndex = await bulkFetchScanResults(scanKeys);

  // Simplified: Just collect vulnerabilities per APKO
  for (const apkoRow of apkoResult.rows) {
    const apkoId = apkoRow.id;
    const tags = apkoRow.tags;

    if (!tags || tags.length === 0) continue;

    const tag = tags[0];
    const vulnerabilities: FixableCVE[] = [];

    // Get latest scan for each architecture
    for (const arch of ["x86_64", "aarch64"]) {
      const scanKey = `${fullImageName}|${tag}|${arch}`;
      const scanData = scanResultIndex.get(scanKey);


      if (!scanData?.matches) continue;

      // Filter for fixable CVEs
      const fixableCVEs = scanData.matches
        .filter((match: any) =>
          match.vulnerability.fix.state === "fixed" &&
          match.vulnerability.fix.versions?.length > 0
        )
        .map((match: any) => {
          return {
            artifactName: match.artifact.name,
            artifactVersion: match.artifact.version,
            fixVersions: match.vulnerability.fix.versions, // Use all fix versions
            artifactType: match.artifact.type,
            cveId: match.vulnerability.id,
            dataSource: match.vulnerability.dataSource || null,
            severity: match.vulnerability.severity,
            epssPercentile: match.vulnerability.epss?.[0]?.percentile || null,
            riskScore: match.vulnerability.risk || null,
            arch: arch,
          };
        });

      vulnerabilities.push(...fixableCVEs);
    }


    // Include ALL APKOs, even those with no vulnerabilities
    // This allows the UI to determine "outdated" relationships
    result.push({
      apkoId,
      tags,
      vulnerabilities,
    });
  }

  return result;
}
