import { getDB } from "../data/db";
import { Image } from "../types/image";
import { getParam } from "../data/param";
import { listTeamSubscriptions } from "../team/subscription";
import { getCatalogItemForImage } from "../catalog/catalog";
import { logger } from "../utils/logger";
import { parseUTCTimestamp } from "../utils/timestamp";
import { getImageReadme } from "./readme";
import * as semver from "semver";

// Helper to count version parts (major, major.minor, or major.minor.patch)
function countVersionParts(version: string): number {
  const clean = version.replace(/^[vV]/, '');
  const matches = clean.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!matches) return 0;
  let count = 0;
  for (let i = 1; i < matches.length; i++) {
    if (matches[i] !== undefined) count++;
  }
  return count;
}

function parseComparableVersion(tag: string): semver.SemVer | null {
  // Prefer full semver parsing so prerelease metadata is preserved for ordering.
  const parsed = semver.parse(tag);
  if (parsed) {
    return parsed;
  }
  // Fallback for partial tags like "1" or "1.2".
  return semver.coerce(tag);
}

// Dynamically determine the default tag for an image
// Logic: Prefer "latest" if it exists, otherwise use highest/most specific semver, then fallback
async function getDefaultTagForImage(imageId: string): Promise<string> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const publishedTagsQuery = `
      SELECT DISTINCT tag
      FROM image_catalog
      WHERE image_id = $1 AND is_published = true
    `;
    const publishedTagsResult = await db.query(publishedTagsQuery, [imageId]);
    const publishedTags = publishedTagsResult.rows.map((row: any) => row.tag);

    if (publishedTags.length === 0) {
      return "latest"; // Fallback if image has no published tags
    }

    // Use same logic as securebuild-app getRepresentativeTag
    if (publishedTags.includes("latest")) {
      return "latest";
    }

    let bestTag = "";
    let bestVersion: semver.SemVer | null = null;
    let maxParts = 0;

    for (const tag of publishedTags) {
      if (tag === "stable" || tag === "main") {
        continue;
      }

      const version = parseComparableVersion(tag);
      if (!version) {
        continue;
      }

      const parts = countVersionParts(tag);
      if (parts > maxParts || (parts === maxParts && (!bestVersion || semver.gt(version, bestVersion)))) {
        bestTag = tag;
        bestVersion = version;
        maxParts = parts;
      }
    }

    if (bestTag) {
      return bestTag;
    }

    // No semver found, sort tags deterministically and return first
    const sortedTags = sortTagsBySemver(publishedTags);
    return sortedTags[0] || "latest";
  } catch (err) {
    logger.error("Failed to get default tag for image", { imageId, error: err });
    return "latest"; // Fallback on error
  }
}

export async function calculateFixedCVECountForImage(id: string, tag: string): Promise<number> {
  logger.debug(`Getting fixed CVE count for image ${id}, tag ${tag}`);
  try {
    const db = getDB(await getParam("DB_URI"));

    // First try to get the pre-calculated value from image_catalog
    const catalogQuery = `SELECT fixed_cve_count_x86 FROM image_catalog WHERE image_id = $1 AND tag = $2 AND is_published = true`;
    const catalogResult = await db.query(catalogQuery, [id, tag]);
    
    if (catalogResult.rows.length > 0 && catalogResult.rows[0].fixed_cve_count_x86 !== null) {
      return catalogResult.rows[0].fixed_cve_count_x86;
    }

    // Fallback to dynamic calculation
    const query = `select alternate_image, name from image where id = $1`;
    const result = await db.query(query, [id]);
    const alternateImage = result.rows[0].alternate_image;
    const securebuildImage = result.rows[0].name;

    if (!alternateImage) {
      return 0;
    }

    // we can't just get the totals and substract b/c sometimes our image has a vuln thats not in the canonical

    const arch = "x86_64"; // TODO: support toggling between x86_64 and aarch64

    const canonicalScanResultQuery = `select result from image_scan where image_name = $1 and image_tag = $2 and image_arch = $3 order by created_at desc limit 1`;
    const canonicalScanResult = await db.query(canonicalScanResultQuery, [alternateImage, tag, arch]);

    const cve0Host = process.env["CVE0_OCI_HOST"] || "cve0.io"
    const fullSecurebuildImageName = `${cve0Host}/${securebuildImage}`
    const secureBuildScanResultQuery = `select result from image_scan where image_name = $1 and image_tag = $2 and image_arch = $3 order by created_at desc limit 1`;
    const secureBuildScanResult = await db.query(secureBuildScanResultQuery, [fullSecurebuildImageName, tag, arch]);

    if (canonicalScanResult.rows.length === 0 || secureBuildScanResult.rows.length === 0) {
      return 0;
    }

    // using our common logic, filter out vulns that aren't starting with cve- and build a list of just the ids
    const canonicalVulns = canonicalScanResult.rows[0].result.matches.filter((match: any) => match.vulnerability.id.startsWith("CVE-")).map((match: any) => match.vulnerability.id);
    const secureBuildVulns = secureBuildScanResult.rows[0].result.matches.filter((match: any) => match.vulnerability.id.startsWith("CVE-")).map((match: any) => match.vulnerability.id);

    // build a list of all vulns in the canonical that aren't in ours by id
    const fixedVulns = canonicalVulns.filter((v: string) => !secureBuildVulns.some((sv: string) => sv === v));
    return fixedVulns.length;

  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getImageByName(name: string): Promise<Image> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select id, name, created_at, updated_at from image where name = $1`;
    const result = await db.query(query, [name]);

    // Check if image was found
    if (result.rows.length === 0) {
      throw new Error(`Image not found: ${name}`);
    }

    const defaultTag = await getDefaultTagForImage(result.rows[0].id);

    const image: Image = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      description: "",
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
      tags: await getPublishedTags(result.rows[0].name),
      catalogItem: await getCatalogItemForImage(result.rows[0].id) || undefined,
      vulnerabilitiesFixed: await calculateFixedCVECountForImage(result.rows[0].id, defaultTag),
      defaultTag: defaultTag,
      defaultTagReadme: await getImageReadme(result.rows[0].id, defaultTag),
      lastBuiltAt: "",
      lastScannedAt: "",
    }

    image.lastBuiltAt = await getImageLastBuiltAt(image.id);
    image.lastScannedAt = await getImageLastScannedAt(image.id);
    return image;
  } catch(err) {
    console.error(err);
    throw err;
  }
}

async function getImageLastBuiltAt(id: string): Promise<string> {
  logger.debug(`Getting last built at for image ${id}`);
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select updated_at::text from image_catalog where image_id = $1 and is_published = true`;
    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return "";
    }

    const parsedDate = parseUTCTimestamp(result.rows[0].updated_at);
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      logger.warn(`Invalid timestamp value for image ${id}: ${result.rows[0].updated_at}`);
      return "";
    }
    return parsedDate.toISOString();
  } catch (err) {
    console.error(err);
    throw err;
  }
}

async function getImageLastScannedAt(id: string): Promise<string> {
  logger.debug(`Getting last scanned at for image ${id}`);
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select last_scanned_at::text from image_catalog where image_id = $1 and is_published = true and last_scanned_at is not null order by last_scanned_at desc limit 1`;
    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return "";
    }

    const parsedDate = parseUTCTimestamp(result.rows[0].last_scanned_at);
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      logger.warn(`Invalid timestamp value for image ${id}: ${result.rows[0].last_scanned_at}`);
      return "";
    }
    return parsedDate.toISOString();
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function listOrgImages(teamId: string): Promise<Image[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const subscriptsions = await listTeamSubscriptions(teamId);
    const catalogItems = subscriptsions.map(s => s.catalogItem);

    const images: Image[] = [];
    for (let i = 0; i < catalogItems.length; i++) {
      const catalogItem = catalogItems[i];

      if (!catalogItem) {
        continue;
      }

      const query = `select id, name, created_at, updated_at from image where id in (select image_id from catalog_image where catalog_id = $1)`;
      const result = await db.query(query, [catalogItem.id]);
      for (let j = 0; j < result.rows.length; j++) {
        const defaultTag = await getDefaultTagForImage(result.rows[j].id);
        images.push({
          id: result.rows[j].id,
          name: result.rows[j].name,
          description: catalogItem.description,
          createdAt: result.rows[j].created_at,
          updatedAt: result.rows[j].updated_at,
          tags: await getPublishedTags(result.rows[j].name),
          catalogItem: catalogItem,
          vulnerabilitiesFixed: await calculateFixedCVECountForImage(result.rows[j].id, defaultTag),
          defaultTag: defaultTag,
          defaultTagReadme: await getImageReadme(result.rows[j].id, defaultTag),
          lastBuiltAt: await getImageLastBuiltAt(result.rows[j].id),
          lastScannedAt: await getImageLastScannedAt(result.rows[j].id),
        });
      }
    }


    return images;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getPublishedTags(imageName: string): Promise<string[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT ic.tag
      FROM image_catalog ic
      JOIN image i ON i.id = ic.image_id
      JOIN image_apko ia ON ia.image_id = i.id
      WHERE i.name = $1 AND ic.is_published = true AND ic.tag = ANY(ia.tags)
    `;
    const result = await db.query(query, [imageName]);
    const tags = result.rows.map(r => r.tag);
    
    // Sort tags using semver logic
    return sortTagsBySemver(tags);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getPublishedTagCountById(imageId: string): Promise<number> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT COUNT(*) as tag_count
      FROM image_catalog ic
      WHERE ic.image_id = $1 AND ic.is_published = true
    `;
    const result = await db.query(query, [imageId]);
    return parseInt(result.rows[0].tag_count);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getAllImagesWithPublishedTagCounts(): Promise<Array<{id: string, name: string, publishedTagCount: number}>> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT i.id, i.name, COUNT(ic.tag) as published_tag_count
      FROM image i
      LEFT JOIN image_catalog ic ON i.id = ic.image_id AND ic.is_published = true
      GROUP BY i.id, i.name
      ORDER BY i.name
    `;
    const result = await db.query(query);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      publishedTagCount: parseInt(row.published_tag_count)
    }));
  } catch (err) {
    console.error(err);
    throw err;
  }
}

function sortTagsBySemver(tags: string[]): string[] {
  // Separate tags into different categories
  const specialTags = ['latest', 'stable', 'main'];
  const semverLikeTags: string[] = [];
  const nonSemverTags: string[] = [];
  
  // Categorize tags
  tags.forEach(tag => {
    if (specialTags.includes(tag)) {
      return; // Handle special tags separately
    }
    
    // Check if it's a valid semver or can be coerced to one
    if (semver.valid(tag)) {
      semverLikeTags.push(tag);
    } else {
      // Try to coerce partial semver (e.g., "3.12" -> "3.12.0")
      const coerced = semver.coerce(tag);
      if (coerced && coerced.version !== '0.0.0') {
        semverLikeTags.push(tag);
      } else {
        nonSemverTags.push(tag);
      }
    }
  });
  
  // Sort all semver tags together - semver.rcompare() handles prerelease ordering correctly
  semverLikeTags.sort((a, b) => {
    const versionA = semver.valid(a) ? a : semver.coerce(a)?.version;
    const versionB = semver.valid(b) ? b : semver.coerce(b)?.version;
    
    if (!versionA || !versionB) return 0;
    return semver.rcompare(versionA, versionB);
  });
  
  nonSemverTags.sort(); // Alphabetical
  
  // Combine in desired order: special tags first, then all semver tags, then non-semver
  const result: string[] = [];
  
  // Add special tags first (in order of preference)
  specialTags.forEach(specialTag => {
    if (tags.includes(specialTag)) {
      result.push(specialTag);
    }
  });
  
  // Add sorted semver tags (includes both stable and prerelease in correct order)
  result.push(...semverLikeTags);
  result.push(...nonSemverTags);
  
  return result;
}

export async function getPublishedTagsForImage(imageId: string): Promise<string[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT ic.tag
      FROM image_catalog ic
      JOIN image_apko ia ON ia.image_id = ic.image_id
      WHERE ic.image_id = $1 AND ic.is_published = true AND ic.tag = ANY(ia.tags)
    `;
    const result = await db.query(query, [imageId]);
    const tags = result.rows.map(r => r.tag);
    
    // Sort tags using semver logic
    return sortTagsBySemver(tags);
  } catch (err) {
    console.error(err);
    throw err;
  }
}
