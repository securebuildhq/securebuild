import { getDB, withTransaction } from "../data/db";
import { getParam } from "../data/param";
import { Image, ImageAPKO, ImageAPKOVersion,ImageContainedInCatalogItem, ImageExternalRegistry, ImageBuild } from "../types/image";
import { CreateImageAPKO } from "./actions/create-image";
import { enqueueWork } from "../utils/queue";
import * as srs from "secure-random-string";
import { getImageTestForLatestVersion, createOrUpdateImageTest } from "./image-test";
import { sortTagsForDisplay } from "../utils/tag-sort";
import * as semver from "semver";
import { pullSpecFromGit, generateOCITagFromTemplate } from "@/lib/gitspec/pull";

function countVersionParts(version: string): number {
  const clean = version.replace(/^[vV]/, "");
  const matches = clean.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!matches) return 0;

  let count = 0;
  for (let i = 1; i < matches.length; i++) {
    if (matches[i] !== undefined) count++;
  }
  return count;
}

function parseComparableVersion(tag: string): semver.SemVer | null {
  const parsed = semver.parse(tag);
  if (parsed) {
    return parsed;
  }
  return semver.coerce(tag);
}

function getRepresentativeTag(tags: string[]): string {
  if (tags.includes("latest")) {
    return "latest";
  }

  let bestTag = "";
  let bestVersion: semver.SemVer | null = null;
  let maxParts = 0;

  for (const tag of tags) {
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

  const sortedTags = sortTagsForDisplay(tags);
  return sortedTags[0] || "latest";
}

export async function deleteImage(id: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await withTransaction(db, async (client) => {
      // Delete in correct order: children first, then parents

      // 1. Delete image_test records that reference image_apko under this image
      await client.query(`
        DELETE FROM image_test
        WHERE apko_id IN (
          SELECT id FROM image_apko WHERE image_id = $1
        )
      `, [id]);

      // 2. Delete image_build records that reference image_apko_versions under this image
      await client.query(`
        DELETE FROM image_build
        WHERE image_apko_version_id IN (
          SELECT iav.id FROM image_apko_version iav
          JOIN image_apko ia ON iav.image_apko_id = ia.id
          WHERE ia.image_id = $1
        )
      `, [id]);

      // 3. Delete image_catalog entries for this image
      await client.query(`DELETE FROM image_catalog WHERE image_id = $1`, [id]);

      // 4. Delete all image_package mappings for this image
      await client.query(`DELETE FROM image_package WHERE image_id = $1`, [id]);

      // 5. Delete image_apko_versions for this image
      await client.query(`
        DELETE FROM image_apko_version
        WHERE image_apko_id IN (
          SELECT id FROM image_apko WHERE image_id = $1
        )
      `, [id]);

      // 6. Delete all image_apko records for this image
      await client.query(`DELETE FROM image_apko WHERE image_id = $1`, [id]);

      // 7. Finally delete the image itself
      await client.query(`DELETE FROM image WHERE id = $1`, [id]);
    });
  } catch (err) {
    console.error(err);
    throw err;
  }
}

async function encryptExternalRegistryPassword(password: string): Promise<string> {
  const secretEncoded = process.env.EXTERNAL_REGISTRY_ENCRYPTION_SECRET;
  if (!secretEncoded) {
    throw new Error("EXTERNAL_REGISTRY_ENCRYPTION_SECRET environment variable is required");
  }

  const secret = Buffer.from(secretEncoded, 'base64').toString('utf-8');

  // Generate a random IV for each encryption
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Create a 32-byte key from the secret using SHA-256
  const keyBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));

  // Import the key for AES-GCM
  const key = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  // Encrypt the password
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    new TextEncoder().encode(password)
  );

  // Combine IV and encrypted data, then base64 encode
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return Buffer.from(combined).toString('base64');
}

export async function createImageExternalRegistry(imageId: string, registryUrl: string, username: string, password: string): Promise<ImageExternalRegistry> {
  try {
    const id = 'er_' + srs.default({ length: 32, alphanumeric: true });

    const encryptedPassword = await encryptExternalRegistryPassword(password);

    const db = getDB(await getParam("DB_URI"));
    const query = `insert into image_external_registry (id, image_id, registry_url, username, password) values ($1, $2, $3, $4, $5)`;
    await db.query(query, [id, imageId, registryUrl, username, encryptedPassword]);

    return getImageExternalRegistry(id);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getImageExternalRegistry(id: string): Promise<ImageExternalRegistry> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select id, registry_url, username from image_external_registry where id = $1`;
    const result = await db.query(query, [id]);
    return {
      id: result.rows[0].id,
      registryUrl: result.rows[0].registry_url,
      username: result.rows[0].username,
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function deleteImageExternalRegistry(id: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `delete from image_external_registry where id = $1`;
    await db.query(query, [id]);
  } catch (err) {
    console.error(err);
    throw err;
  }
}
export async function listImages(): Promise<Image[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Get basic image info and last build status
    const query = `
      SELECT
        i.id, i.name, i.created_at, i.updated_at, i.alternate_image, i.readme,
        (SELECT ib.status
         FROM image_build ib
         JOIN image_apko_version iav ON ib.image_apko_version_id = iav.id
         JOIN image_apko ia ON iav.image_apko_id = ia.id
         WHERE ia.image_id = i.id
         ORDER BY ib.created_at DESC
         LIMIT 1) as last_build_status
      FROM image i
    `;
    const result = await db.query(query);

    // Get all external registries in bulk
    const extRegQuery = `
      SELECT image_id, id, registry_url, username
      FROM image_external_registry
      WHERE image_id = ANY($1)
    `;
    const imageIds = result.rows.map(row => row.id);
    const extRegResult = imageIds.length > 0 ? await db.query(extRegQuery, [imageIds]) : { rows: [] };

    // Group external registries by image_id
    const extRegsByImageId: Record<string, ImageExternalRegistry[]> = {};
    for (const row of extRegResult.rows) {
      if (!extRegsByImageId[row.image_id]) {
        extRegsByImageId[row.image_id] = [];
      }
      extRegsByImageId[row.image_id].push({
        id: row.id,
        registryUrl: row.registry_url,
        username: row.username,
      });
    }

    // Get all published tags for all images in bulk
    const allTagsQuery = `
      SELECT image_id, tag
      FROM image_catalog
      WHERE image_id = ANY($1) AND is_published = true
    `;
    const allTagsResult = imageIds.length > 0 ? await db.query(allTagsQuery, [imageIds]) : { rows: [] };

    // Group tags by image_id
    const tagsByImageId: Record<string, string[]> = {};
    for (const row of allTagsResult.rows) {
      if (!tagsByImageId[row.image_id]) {
        tagsByImageId[row.image_id] = [];
      }
      tagsByImageId[row.image_id].push(row.tag);
    }

    // Determine representative tag for each image using default-tag logic:
    // prefer "latest", then highest/most specific semver, then fallback.
    const representativeTagByImageId: Record<string, string> = {};
    for (const imageId of imageIds) {
      const tags = tagsByImageId[imageId] || [];
      if (tags.length > 0) {
        representativeTagByImageId[imageId] = getRepresentativeTag(tags);
      }
    }

    // Get scan data for representative tags in bulk
    const scanDataQuery = `
      SELECT image_id, tag, created_at, last_scanned_at, last_scan_result_x86, last_scan_result_alternate_x86
      FROM image_catalog
      WHERE (image_id, tag) IN (SELECT unnest($1::text[]), unnest($2::text[]))
        AND is_published = true
    `;
    const imageIdArray = Object.keys(representativeTagByImageId);
    const tagArray = imageIdArray.map(id => representativeTagByImageId[id]);
    const scanDataResult = imageIdArray.length > 0
      ? await db.query(scanDataQuery, [imageIdArray, tagArray])
      : { rows: [] };

    // Group scan data by image_id
    const scanDataByImageId: Record<string, any> = {};
    for (const row of scanDataResult.rows) {
      scanDataByImageId[row.image_id] = row;
    }

    const images: Image[] = [];
    for (const row of result.rows) {
      const image: Image = {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        alternateImage: row.alternate_image,
        readme: row.readme,
        apkos: [],
        catalogItems: [],
        currentTags: [],
        lastScannedAt: null,
        lastBuiltAt: null,
        lastBuildStatus: row.last_build_status,
        defaultTagVulnCounts: { critical: 0, high: 0, medium: 0, low: 0 },
        canonicalVulnCounts: { critical: 0, high: 0, medium: 0, low: 0 },
        externalRegistries: extRegsByImageId[row.id] || [],
      };

      // Process scan data for representative tag
      const scanData = scanDataByImageId[row.id];
      if (scanData) {
        image.lastScannedAt = scanData.last_scanned_at;
        image.lastBuiltAt = scanData.created_at;

        // Process SecureBuild scan results
        if (scanData.last_scan_result_x86) {
          try {
            const parsed = JSON.parse(scanData.last_scan_result_x86);
            if (parsed.matches) {
              parsed.matches.filter((match: any) => match.vulnerability.id.startsWith("CVE-")).forEach((match: any) => {
                const severity = match.vulnerability?.severity?.toLowerCase();
                switch (severity) {
                  case 'critical': image.defaultTagVulnCounts.critical++; break;
                  case 'high': image.defaultTagVulnCounts.high++; break;
                  case 'medium': image.defaultTagVulnCounts.medium++; break;
                  case 'low': image.defaultTagVulnCounts.low++; break;
                }
              });
            }
          } catch (parseErr) {
            console.warn(`Failed to parse last_scan_result_x86 for image ${row.id}:`, parseErr);
          }
        }

        // Process alternate scan results
        if (scanData.last_scan_result_alternate_x86) {
          try {
            const parsed = JSON.parse(scanData.last_scan_result_alternate_x86);
            if (parsed.matches) {
              parsed.matches.filter((match: any) => match.vulnerability.id.startsWith("CVE-")).forEach((match: any) => {
                const severity = match.vulnerability?.severity?.toLowerCase();
                switch (severity) {
                  case 'critical': image.canonicalVulnCounts.critical++; break;
                  case 'high': image.canonicalVulnCounts.high++; break;
                  case 'medium': image.canonicalVulnCounts.medium++; break;
                  case 'low': image.canonicalVulnCounts.low++; break;
                }
              });
            }
          } catch (parseErr) {
            console.warn(`Failed to parse last_scan_result_alternate_x86 for image ${row.id}:`, parseErr);
          }
        }
      }

      images.push(image);
    }

    // Get fixable CVE counts for all images
    // Sum all CVEs across all APKOs for each image
    if (imageIds.length > 0) {
      const { getFixableCVEs } = await import("./actions/get-fixable-cves");

      for (const image of images) {
        try {
          const fixableCVEs = await getFixableCVEs(image.name, image.id);

          // Count all CVEs across all APKOs (deduplicate within each APKO by CVE ID)
          let totalCveCount = 0;
          fixableCVEs
            .filter(apko => apko.vulnerabilities.length > 0)
            .forEach(apko => {
              // Deduplicate CVEs within this APKO (same CVE across different architectures)
              const uniqueCveIds = new Set(apko.vulnerabilities.map(vuln => vuln.cveId));
              totalCveCount += uniqueCveIds.size;
            });

          image.fixableCVECount = totalCveCount;
        } catch (error) {
          console.error(`Error counting CVEs for image ${image.id}:`, error);
          image.fixableCVECount = 0;
        }
      }
    }

    return images;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function listImageExternalRegistries(id: string): Promise<ImageExternalRegistry[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select id, registry_url, username from image_external_registry where image_id = $1`;
    const result = await db.query(query, [id]);
    return result.rows.map((row) => ({
      id: row.id,
      registryUrl: row.registry_url,
      username: row.username,
    }));
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function listImageCatalogItems(id: string): Promise<ImageContainedInCatalogItem[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select catalog.id, catalog.name from catalog where id in (select catalog_id from catalog_image where image_id = $1)`;
    const result = await db.query(query, [id]);
    return result.rows.map((row) => ({
      catalogItemId: row.id,
      catalogItemName: row.name,
    }));
  } catch (err) {
    console.error(err);
    throw err;
  }

}


export async function updateAlternateImage(imageId: string, alternateImage: string): Promise<Image> {
  try {
    const db = getDB(await getParam("DB_URI"))
    const query = `update image set alternate_image = $1 where id = $2`;
    await db.query(query, [alternateImage, imageId]);

    return getImage(imageId);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function updateImageGitLink(
  imageId: string,
  gitRemote: string | null,
  apkoFilePath: string | null,
  imageTagTemplate: string | null,
): Promise<Image> {
  try {
    const db = getDB(await getParam("DB_URI"))
    await db.query(
      `update image set git_remote = $1, apko_file_path = $2, image_tag_template = $3, updated_at = now() where id = $4`,
      [gitRemote, apkoFilePath, imageTagTemplate, imageId],
    );
    return getImage(imageId);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function createImage(name: string, alternateImage: string, apkos: CreateImageAPKO[]): Promise<Image> {
  try {
    const db = getDB(await getParam("DB_URI"))
    const imageId = 'i' + srs.default({ length: 32, alphanumeric: true });
    await withTransaction(db, async (client) => {

      const imageQuery = `insert into image (id, name, alternate_image, created_at, updated_at) values ($1, $2, $3, now(), now())`;
      await client.query(imageQuery, [imageId, name, alternateImage]);

      for (const apko of apkos) {
        const apkoId = 'a' + srs.default({ length: 32, alphanumeric: true });
        const apkoQuery = `insert into image_apko (id, image_id, name, tags, created_at, updated_at) values ($1, $2, $3, $4, now(), now())`;
        await client.query(apkoQuery, [apkoId, imageId, apko.name, apko.tags]);

        const apkoVersionId = 'av' + srs.default({ length: 32, alphanumeric: true });
        const apkoVersionQuery = `insert into image_apko_version (id, image_apko_id, apko_yaml, created_at, updated_at) values ($1, $2, $3, now(), now())`;
        await client.query(apkoVersionQuery, [apkoVersionId, apkoId, apko.yaml]);
      }
    })

    return getImage(imageId);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function imageExists(name: string): Promise<boolean> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select id from image where name = $1`;
    const result = await db.query(query, [name]);
    return result.rows.length > 0;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function setImageReadme(id: string, readme: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `update image set readme = $1 where id = $2`;
    await db.query(query, [readme, id]);
  } catch (err) {
    console.error(err);
    throw err;
  }
}
export async function getImageByName(name: string): Promise<Image | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select id from image where name = $1`;
    const result = await db.query(query, [name]);

    if (result.rows.length === 0) {
      return null;
    }

    return await getImage(result.rows[0].id);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getImage(id: string): Promise<Image> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select id, name, created_at, updated_at, alternate_image, readme, is_public, git_remote, apko_file_path, image_tag_template from image where id = $1`;
    const result = await db.query(query, [id]);

    const image: Image = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
      alternateImage: result.rows[0].alternate_image,
      readme: result.rows[0].readme,
      isPublic: result.rows[0].is_public,
      gitRemote: result.rows[0].git_remote || undefined,
      apkoFilePath: result.rows[0].apko_file_path || undefined,
      imageTagTemplate: result.rows[0].image_tag_template || undefined,
      apkos: await listImageAPKOs(id),
      catalogItems: [],
      currentTags: [],
      lastScannedAt: null,
      lastBuiltAt: null,
      lastBuildStatus: null,
      defaultTagVulnCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      canonicalVulnCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      externalRegistries: await listImageExternalRegistries(id),
    }

    const query2 = `select catalog.id, catalog.name from catalog where id in (select catalog_id from catalog_image where image_id = $1)`;
    const result2 = await db.query(query2, [id]);
    image.catalogItems = result2.rows.map((row) => ({
      catalogItemId: row.id,
      catalogItemName: row.name,
    }));

    // Get last build status
    const lastBuildQuery = `
      SELECT ib.status
      FROM image_build ib
      JOIN image_apko_version iav ON ib.image_apko_version_id = iav.id
      JOIN image_apko ia ON iav.image_apko_id = ia.id
      WHERE ia.image_id = $1
      ORDER BY ib.created_at DESC
      LIMIT 1
    `;
    const lastBuildResult = await db.query(lastBuildQuery, [image.id]);
    if (lastBuildResult.rows.length > 0) {
      image.lastBuildStatus = lastBuildResult.rows[0].status;
    }

    // Get representative tag for vulnerability counts and scan timestamps
    // Use default-tag logic: "latest" first, then highest semver, then fallback
    const publishedTagsQuery = `SELECT DISTINCT tag FROM image_catalog WHERE image_id = $1 AND is_published = true`;
    const publishedTagsResult = await db.query(publishedTagsQuery, [id]);
    const publishedTags = publishedTagsResult.rows.map((row: any) => row.tag);

    if (publishedTags.length > 0) {
      const representativeTag = getRepresentativeTag(publishedTags);

      // Query scan data for the representative tag
      const scanDataQuery = `
        SELECT created_at, last_scanned_at, last_scan_result_x86, last_scan_result_alternate_x86
        FROM image_catalog
        WHERE image_id = $1 AND tag = $2 AND is_published = true
      `;
      const scanDataResult = await db.query(scanDataQuery, [id, representativeTag]);

      if (scanDataResult.rows.length > 0) {
        const row = scanDataResult.rows[0];
        image.lastScannedAt = row.last_scanned_at;
        image.lastBuiltAt = row.created_at;

        // Parse SecureBuild scan results for vulnerability counts
        if (row.last_scan_result_x86) {
          try {
            const vulnCounts = JSON.parse(row.last_scan_result_x86);
            if (vulnCounts.matches) {
              vulnCounts.matches
                .filter((match: any) => match.vulnerability?.id?.startsWith("CVE-"))
                .forEach((match: any) => {
                  const severity = match.vulnerability?.severity?.toLowerCase();
                  switch (severity) {
                    case "critical": image.defaultTagVulnCounts.critical++; break;
                    case "high": image.defaultTagVulnCounts.high++; break;
                    case "medium": image.defaultTagVulnCounts.medium++; break;
                    case "low": image.defaultTagVulnCounts.low++; break;
                  }
                });
            }
          } catch (parseErr) {
            console.warn("Failed to parse last_scan_result_x86:", parseErr);
          }
        }

        // Parse alternate/canonical scan results for vulnerability counts
        if (row.last_scan_result_alternate_x86) {
          try {
            const vulnCounts = JSON.parse(row.last_scan_result_alternate_x86);
            if (vulnCounts.matches) {
              vulnCounts.matches
                .filter((match: any) => match.vulnerability?.id?.startsWith("CVE-"))
                .forEach((match: any) => {
                  const severity = match.vulnerability?.severity?.toLowerCase();
                  switch (severity) {
                    case "critical": image.canonicalVulnCounts.critical++; break;
                    case "high": image.canonicalVulnCounts.high++; break;
                    case "medium": image.canonicalVulnCounts.medium++; break;
                    case "low": image.canonicalVulnCounts.low++; break;
                  }
                });
            }
          } catch (parseErr) {
            console.warn("Failed to parse last_scan_result_alternate_x86:", parseErr);
          }
        }
      }
    }

    const query3 = `select tag, created_at, last_scanned_at from image_catalog where image_id = $1 and is_published = true order by created_at desc`;
    const result3 = await db.query(query3, [id]);
    for (const row of result3.rows) {
      image.currentTags.push({
        tag: row.tag,
        builtAt: row.created_at,
        lastScannedAt: row.last_scanned_at,
      });
    }

    return image;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function updateImageAPKOYaml(id: string, apkoId: string, yaml: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Block editing of linked APKOs (pulled from git)
    const apkoResult = await db.query(`SELECT git_tag FROM image_apko WHERE id = $1`, [apkoId]);
    if (apkoResult.rows.length > 0 && apkoResult.rows[0].git_tag) {
      throw new Error("Cannot edit APKO YAML for a linked image. The APKO is pulled from a git repository.");
    }

    // Get existing test from the latest version before creating new version
    const existingTest = await getImageTestForLatestVersion(apkoId);

    const versionId = 'av' + srs.default({ length: 32, alphanumeric: true });
    const query = `insert into image_apko_version (id, image_apko_id, apko_yaml, created_at, updated_at) values ($1, $2, $3, now(), now())`;
    await db.query(query, [versionId, apkoId, yaml]);

    // Copy the test from the previous version to the new version
    if (existingTest) {
      try {
        await createOrUpdateImageTest(apkoId, versionId, existingTest.yamlContent, existingTest.description ?? undefined);
      } catch (testErr) {
        console.warn("Failed to copy test to new APKO version:", testErr);
      }
    }

    // Enqueue GitHub sync after successfully updating APKO YAML
    await enqueueWork('github_sync', {}).catch(err => {
      console.warn('Failed to enqueue GitHub sync after APKO update:', err);
    });
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function createGenerateApko(imageId: string): Promise<ImageAPKO> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const apkoId = 'a' + srs.default({ length: 32, alphanumeric: true });
    const query = `insert into image_apko (id, image_id, name, tags, created_at, updated_at) values ($1, $2, $3, $4, now(), now())`;
    await db.query(query, [apkoId, imageId, "APKO", []]);

    const apkoVersionId = 'av' + srs.default({ length: 32, alphanumeric: true });
    const apkoVersionQuery = `insert into image_apko_version (id, image_apko_id, apko_yaml, created_at, updated_at) values ($1, $2, $3, now(), now())`;
    await db.query(apkoVersionQuery, [apkoVersionId, apkoId, ""]);

    return {
      id: apkoId,
      name: "APKO",
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      latestVersion: await getLatestImageAPKOVersion(apkoId),
      readme: null,
      lastBuiltAt: null,
      testYaml: null,
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function setImageApkoReadme(id: string, readme: string): Promise<ImageAPKO> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `update image_apko set readme = $1 where id = $2`;
    await db.query(query, [readme || null, id]);

    return await getImageAPKO(id);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getImageAPKO(id: string): Promise<ImageAPKO> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select id, name, tags, created_at, updated_at, readme, last_built_at from image_apko where id = $1`;
    const result = await db.query(query, [id]);

    const latestVersion = await getLatestImageAPKOVersion(id);

    // Get test YAML for the latest version
    const testQuery = `
      SELECT yaml_content
      FROM image_test
      WHERE apko_id = $1 AND apko_version_id = $2
    `;
    const testResult = await db.query(testQuery, [id, latestVersion.id]);
    const testYaml = testResult.rows.length > 0 ? testResult.rows[0].yaml_content : null;

    return {
      id: result.rows[0].id,
      name: result.rows[0].name,
      tags: result.rows[0].tags,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
      latestVersion: latestVersion,
      readme: result.rows[0].readme,
      lastBuiltAt: result.rows[0].last_built_at || null,
      testYaml: testYaml,
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function listImageAPKOs(id: string): Promise<ImageAPKO[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select id, name, tags, created_at, updated_at, readme, last_built_at, git_remote, git_tag, apko_file_path from image_apko where image_id = $1`;
    const result = await db.query(query, [id]);

    const apkos: ImageAPKO[] = [];
    for (const row of result.rows) {
      const latestVersion = await getLatestImageAPKOVersion(row.id);

      // Get test YAML for the latest version
      const testQuery = `
        SELECT yaml_content
        FROM image_test
        WHERE apko_id = $1 AND apko_version_id = $2
      `;
      const testResult = await db.query(testQuery, [row.id, latestVersion.id]);
      const testYaml = testResult.rows.length > 0 ? testResult.rows[0].yaml_content : null;

      apkos.push({
        id: row.id,
        name: row.name,
        tags: row.tags,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        latestVersion: latestVersion,
        readme: row.readme,
        lastBuiltAt: row.last_built_at,
        testYaml: testYaml,
        gitTag: row.git_tag || undefined,
        gitCommitSha: latestVersion.gitCommitSha,
        apkoFilePath: row.apko_file_path || undefined,
      });
    }

    return apkos;
  } catch (err) {
    console.error("Failed to list image APKOs:", err);
    throw new Error(`Failed to list image APKOs for image ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getLatestImageAPKOVersion(id: string): Promise<ImageAPKOVersion> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select id, apko_yaml, created_at, updated_at, git_remote, apko_file_path, git_commit_sha from image_apko_version where image_apko_id = $1 order by created_at desc limit 1`;
    const result = await db.query(query, [id]);

    const apkoVersion: ImageAPKOVersion = {
      id: result.rows[0].id,
      apkoYaml: result.rows[0].apko_yaml,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
      gitRemote: result.rows[0].git_remote || undefined,
      apkoFilePath: result.rows[0].apko_file_path || undefined,
      gitCommitSha: result.rows[0].git_commit_sha || undefined,
    }

    return apkoVersion;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function updateImageAPKOTags(apkoId: string, tags: string[]): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `update image_apko set tags = $1, updated_at = now() where id = $2`;
    await db.query(query, [tags, apkoId]);

    // Enqueue GitHub sync after successfully updating tags
    await enqueueWork('github_sync', {}).catch(err => {
      console.warn('Failed to enqueue GitHub sync after tags update:', err);
    });
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function deleteImageApko(apkoId: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await withTransaction(db, async (client) => {
      // Delete in correct order: children first, then parents
      // This ensures referential integrity without foreign key constraints

      // 1. Delete image_test records that reference this apko
      await client.query(`DELETE FROM image_test WHERE apko_id = $1`, [apkoId]);

      // 2. Delete image_build records that reference image_apko_versions under this apko
      await client.query(`
        DELETE FROM image_build
        WHERE image_apko_version_id IN (
          SELECT id FROM image_apko_version WHERE image_apko_id = $1
        )
      `, [apkoId]);

      // 3. Delete image_catalog entries for this apko
      await client.query(`DELETE FROM image_catalog WHERE apko_id = $1`, [apkoId]);

      // 4. Delete image_package mappings for this apko
      await client.query(`DELETE FROM image_package WHERE apko_id = $1`, [apkoId]);

      // 5. Delete image_apko_versions for this apko
      await client.query(`DELETE FROM image_apko_version WHERE image_apko_id = $1`, [apkoId]);

      // 6. Finally delete the image_apko itself
      await client.query(`DELETE FROM image_apko WHERE id = $1`, [apkoId]);
    });
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getImagePackages(imageId: string): Promise<{id: string, name: string, createdAt: Date, updatedAt: Date}[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT p.id, p.name, p.created_at, p.updated_at
      FROM package p
      INNER JOIN image_package ip ON p.id = ip.package_id
      WHERE ip.image_id = $1
      ORDER BY p.name ASC
    `;
    const result = await db.query(query, [imageId]);

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getAPKOPackages(apkoId: string): Promise<{id: string, name: string, createdAt: Date, updatedAt: Date}[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT p.id, p.name, p.created_at, p.updated_at
      FROM package p
      INNER JOIN image_package ip ON p.id = ip.package_id
      WHERE ip.apko_id = $1
      ORDER BY p.name ASC
    `;
    const result = await db.query(query, [apkoId]);

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getImageBuildsByImageId(imageId: string): Promise<ImageBuild[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT 
        ib.id, 
        ib.image_apko_version_id, 
        i.id as image_id,
        i.name as image_name,
        COALESCE(ia.tags, ARRAY[]::text[]) as image_tags,
        ib.status, 
        ib.created_at, 
        ib.timeout_at, 
        ib.builder_id, 
        ib.build_started_at, 
        ib.build_finished_at
      FROM image_build ib
      LEFT JOIN image_apko_version iav ON ib.image_apko_version_id = iav.id
      LEFT JOIN image_apko ia ON iav.image_apko_id = ia.id
      LEFT JOIN image i ON ia.image_id = i.id
      WHERE i.id = $1
      ORDER BY ib.created_at DESC
      LIMIT 100
    `;
    
    const result = await db.query(query, [imageId]);
    
    return result.rows.map(row => ({
      id: row.id,
      imageId: row.image_id,
      imageApkoVersionId: row.image_apko_version_id,
      imageName: row.image_name,
      imageTags: Array.isArray(row.image_tags) ? row.image_tags : [],
      status: row.status,
      createdAt: row.created_at,
      timeoutAt: row.timeout_at,
      builderId: row.builder_id,
      buildStartedAt: row.build_started_at,
      buildFinishedAt: row.build_finished_at,
    }));
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getImageBuild(buildId: string): Promise<ImageBuild | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT 
        ib.id, 
        ib.image_apko_version_id, 
        i.id as image_id,
        i.name as image_name,
        COALESCE(ia.tags, ARRAY[]::text[]) as image_tags,
        ib.status, 
        ib.created_at, 
        ib.timeout_at, 
        ib.builder_id, 
        ib.build_started_at, 
        ib.build_finished_at,
        ib.apko_stdout, 
        ib.apko_stderr, 
        ib.grype_aarch64_stderr, 
        ib.grype_x86_64_stderr, 
        ib.grype_alternate_aarch64_stderr, 
        ib.grype_alternate_x86_64_stderr, 
         
        ib.builder_stdout,
        ib.worker_error
      FROM image_build ib
      LEFT JOIN image_apko_version iav ON ib.image_apko_version_id = iav.id
      LEFT JOIN image_apko ia ON iav.image_apko_id = ia.id
      LEFT JOIN image i ON ia.image_id = i.id
      WHERE ib.id = $1
    `;
    
    const result = await db.query(query, [buildId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row = result.rows[0];
    return {
      id: row.id,
      imageId: row.image_id,
      imageApkoVersionId: row.image_apko_version_id,
      imageName: row.image_name,
      imageTags: Array.isArray(row.image_tags) ? row.image_tags : [],
      status: row.status,
      createdAt: row.created_at,
      timeoutAt: row.timeout_at,
      builderId: row.builder_id,
      buildStartedAt: row.build_started_at,
      buildFinishedAt: row.build_finished_at,
      apkoStdout: row.apko_stdout,
      apkoStderr: row.apko_stderr,
      grypeAarch64Stderr: row.grype_aarch64_stderr,
      grypeX86_64Stderr: row.grype_x86_64_stderr,
      grypeAlternateAarch64Stderr: row.grype_alternate_aarch64_stderr,
      grypeAlternateX86_64Stderr: row.grype_alternate_x86_64_stderr,

      builderStdout: row.builder_stdout,
      workerError: row.worker_error,
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function listAllImageBuilds(): Promise<ImageBuild[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT 
        ib.id, 
        ib.image_apko_version_id, 
        i.id as image_id,
        i.name as image_name,
        COALESCE(ia.tags, ARRAY[]::text[]) as image_tags,
        ib.status, 
        ib.created_at, 
        ib.timeout_at, 
        ib.builder_id, 
        ib.build_started_at, 
        ib.build_finished_at
      FROM image_build ib
      LEFT JOIN image_apko_version iav ON ib.image_apko_version_id = iav.id
      LEFT JOIN image_apko ia ON iav.image_apko_id = ia.id
      LEFT JOIN image i ON ia.image_id = i.id
      ORDER BY ib.created_at DESC
    `;

    const result = await db.query(query);

    return result.rows.map(row => ({
      id: row.id,
      imageId: row.image_id,
      imageApkoVersionId: row.image_apko_version_id,
      imageName: row.image_name,
      imageTags: Array.isArray(row.image_tags) ? row.image_tags : [],
      status: row.status,
      createdAt: row.created_at,
      timeoutAt: row.timeout_at,
      builderId: row.builder_id,
      buildStartedAt: row.build_started_at,
      buildFinishedAt: row.build_finished_at,
    }));
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export interface CreateLinkedImageRequest {
  name: string;
  gitRemote: string;
  apkoFilePath: string;
  testFilePath?: string;
  imageTagTemplate: string;
  gitTag: string;
}

export async function createLinkedImage(req: CreateLinkedImageRequest): Promise<Image> {
  const { name, gitRemote, apkoFilePath, testFilePath, imageTagTemplate, gitTag } = req;

  const specContent = pullSpecFromGit(gitRemote, apkoFilePath, gitTag);
  const ociTag = generateOCITagFromTemplate(imageTagTemplate, gitTag);

  let testYaml: string | undefined;
  if (testFilePath) {
    try {
      const testSpec = pullSpecFromGit(gitRemote, testFilePath, gitTag);
      testYaml = testSpec.content;
    } catch (err) {
      console.warn(`Failed to pull test file from git: ${err}`);
    }
  }

  const db = getDB(await getParam("DB_URI"));
  const imageId = 'i' + srs.default({ length: 32, alphanumeric: true });

  await withTransaction(db, async (client) => {
    await client.query(
      `insert into image (id, name, created_at, updated_at, git_remote, apko_file_path, image_tag_template) values ($1, $2, now(), now(), $3, $4, $5)`,
      [imageId, name, gitRemote, apkoFilePath, imageTagTemplate]
    );

    const apkoId = 'a' + srs.default({ length: 32, alphanumeric: true });
    await client.query(
      `insert into image_apko (id, image_id, name, tags, created_at, updated_at, git_remote, git_tag, apko_file_path) values ($1, $2, $3, $4, now(), now(), $5, $6, $7)`,
      [apkoId, imageId, ociTag, [ociTag], gitRemote, gitTag, apkoFilePath]
    );

    const apkoVersionId = 'av' + srs.default({ length: 32, alphanumeric: true });
    await client.query(
      `insert into image_apko_version (id, image_apko_id, apko_yaml, created_at, updated_at, git_remote, apko_file_path, git_commit_sha) values ($1, $2, $3, now(), now(), $4, $5, $6)`,
      [apkoVersionId, apkoId, specContent.content, gitRemote, apkoFilePath, specContent.commitSha]
    );

    if (testYaml) {
      await client.query(
        `insert into image_test (apko_id, apko_version_id, yaml_content, created_at, updated_at) values ($1, $2, $3, now(), now())`,
        [apkoId, apkoVersionId, testYaml]
      );
    }
  });

  return getImage(imageId);
}

export async function addLinkedImageApko(imageId: string, gitTag: string): Promise<Image> {
  const db = getDB(await getParam("DB_URI"));

  const imageResult = await db.query(
    `select git_remote, apko_file_path, image_tag_template from image where id = $1`,
    [imageId]
  );

  if (imageResult.rows.length === 0) {
    throw new Error(`Image ${imageId} not found`);
  }

  const { git_remote, apko_file_path, image_tag_template } = imageResult.rows[0];
  if (!git_remote || !apko_file_path) {
    throw new Error(`Image ${imageId} is not linked to a git repository`);
  }

  const existingResult = await db.query(
    `select id from image_apko where image_id = $1 and git_tag = $2`,
    [imageId, gitTag]
  );
  if (existingResult.rows.length > 0) {
    throw new Error(`An APKO with git tag "${gitTag}" already exists for this image`);
  }

  const specContent = pullSpecFromGit(git_remote, apko_file_path, gitTag);
  const ociTag = generateOCITagFromTemplate(image_tag_template, gitTag);

  const apkoId = 'a' + srs.default({ length: 32, alphanumeric: true });
  const apkoVersionId = 'av' + srs.default({ length: 32, alphanumeric: true });

  await withTransaction(db, async (client) => {
    await client.query(
      `insert into image_apko (id, image_id, name, tags, created_at, updated_at, git_remote, git_tag, apko_file_path) values ($1, $2, $3, $4, now(), now(), $5, $6, $7)`,
      [apkoId, imageId, ociTag, [ociTag], git_remote, gitTag, apko_file_path]
    );

    await client.query(
      `insert into image_apko_version (id, image_apko_id, apko_yaml, created_at, updated_at, git_remote, apko_file_path, git_commit_sha) values ($1, $2, $3, now(), now(), $4, $5, $6)`,
      [apkoVersionId, apkoId, specContent.content, git_remote, apko_file_path, specContent.commitSha]
    );
  });

  return getImage(imageId);
}
