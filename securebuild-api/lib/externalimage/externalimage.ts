import { TrackedExternalImage } from '../types/externalimage';
import { getDB, withTransaction } from '../data/db';
import { getParam } from '../data/param';
import { traceFunction } from '../observability/tracing';
import { parseUTCTimestamp } from '../utils/timestamp';
import { enqueueWork } from '../utils/queue';


export async function upsertExternalImage(registry: string, imageName: string, imageTag: string, digest: string, username: string | null, password: string | null, teamId: string): Promise<TrackedExternalImage> {
  try {
    const db = getDB(await getParam("DB_URI"))

    await withTransaction(db, async (client) => {
      const inFourHours = new Date(Date.now() + 1000 * 60 * 60 * 4)
      const query = `insert into external_image (registry, image_name, created_at) values ($1, $2, $3) on conflict (registry, image_name) do nothing`

      await client.query(query, [registry, imageName, new Date()])

      const queryTag = `insert into external_image_tag (registry, image_name, image_tag, created_at, last_submitted_at, digest, next_check_digest_at, next_scan_at) values ($1, $2, $3, $4, $4, $5, $6, $7) on conflict (registry, image_name, image_tag) do update set digest = $5, next_check_digest_at = $6, next_scan_at = $7, last_submitted_at = $4`
      await client.query(queryTag, [registry, imageName, imageTag, new Date(), digest, inFourHours, inFourHours])

      if (username && password) {
        let encryptedPassword: string | null = null;
        if (password) {
          encryptedPassword = await encryptPassword(password);
        }

        const query = `insert into external_image_credential (registry, image_name, username, password, created_at, team_id) values ($1, $2, $3, $4, $5, $6) on conflict (registry, image_name, team_id) do update set username = $3, password = $4`
        await client.query(query, [registry, imageName, username, encryptedPassword, new Date(), teamId])
      }

      const teamQuery = `insert into external_image_team (team_id, registry, image_name, image_tag, created_at) values ($1, $2, $3, $4, $5) on conflict (team_id, registry, image_name, image_tag) do nothing`
      await client.query(teamQuery, [teamId, registry, imageName, imageTag, new Date()])
    })

    // Initialize SBOM status as 'pending' to ensure it's immediately available via the API
    // Uses ON CONFLICT DO NOTHING so it's safe to call unconditionally
    // Non-critical: if this fails we still want to enqueue SBOM work and proceed.
    try {
      await initializeSBOMStatusPending(digest)
    } catch (err) {
      console.warn(`initializeSBOMStatusPending failed for digest ${digest}:`, err)
    }

    return getExternalImageForTeam(teamId, registry, imageName);

  } catch (err) {
    console.error(`upsertExternalImage error:`, err)
    throw new Error(`Failed to upsert external image: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }
}

export async function listExternalImageTags(teamId: string, registry: string, imageName: string): Promise<string[]> {
  try {
    const db = getDB(await getParam("DB_URI"))

    const query = `select image_tag from external_image_team where team_id = $1 and image_name = $2 and registry = $3`
    const result = await db.query(query, [teamId, imageName, registry])

    return result.rows.map((row) => row.image_tag)
  } catch (err) {
    console.error(`listExternalImageTags error:`, err)
    throw new Error(`Failed to list external image tags: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }
}

export async function listExternalImages(teamId: string): Promise<TrackedExternalImage[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Single query that gets all external images, their tags, and completion status
    // Uses EXISTS subqueries to check for completion status across all architectures
    // Also gets the SBOM status (priority: failed > generating > pending > succeeded) and scan status (priority: failed > running > queued > succeeded)
    // Note: is_scan_complete requires status='succeeded' to prevent showing stale data during rescans
    const query = `
      SELECT DISTINCT
        eteam.registry,
        eteam.image_name,
        eimg.created_at,
        etag.image_tag,
        etag.digest,
        etag.created_at,
        EXISTS(SELECT 1 FROM external_image_sbom esbom WHERE esbom.digest = etag.digest) as is_sbom_complete,
        EXISTS(SELECT 1 FROM external_image_scan escan WHERE escan.digest = etag.digest AND escan.status = 'succeeded') as is_scan_complete,
        (
          SELECT CASE
            WHEN EXISTS(SELECT 1 FROM external_image_sbom_status esbom_status WHERE esbom_status.digest = etag.digest AND esbom_status.status = 'failed') THEN 'failed'
            WHEN EXISTS(SELECT 1 FROM external_image_sbom_status esbom_status WHERE esbom_status.digest = etag.digest AND esbom_status.status = 'generating') THEN 'generating'
            WHEN EXISTS(SELECT 1 FROM external_image_sbom_status esbom_status WHERE esbom_status.digest = etag.digest AND esbom_status.status = 'pending') THEN 'pending'
            WHEN EXISTS(SELECT 1 FROM external_image_sbom_status esbom_status WHERE esbom_status.digest = etag.digest AND esbom_status.status = 'succeeded') THEN 'succeeded'
            -- If SBOM exists but no status row, infer succeeded (for backwards compatibility with SBOMs created before status tracking)
            WHEN EXISTS(SELECT 1 FROM external_image_sbom esbom WHERE esbom.digest = etag.digest) THEN 'succeeded'
            ELSE NULL
          END
        ) as sbom_status,
        (
          SELECT CASE
            WHEN EXISTS(SELECT 1 FROM external_image_scan escan WHERE escan.digest = etag.digest AND escan.status = 'failed') THEN 'failed'
            WHEN EXISTS(SELECT 1 FROM external_image_scan escan WHERE escan.digest = etag.digest AND escan.status = 'running') THEN 'running'
            WHEN EXISTS(SELECT 1 FROM external_image_scan escan WHERE escan.digest = etag.digest AND escan.status = 'queued') THEN 'queued'
            WHEN EXISTS(SELECT 1 FROM external_image_scan escan WHERE escan.digest = etag.digest AND escan.status = 'succeeded') THEN 'succeeded'
            ELSE NULL
          END
        ) as scan_status
      FROM external_image_team eteam
        INNER JOIN external_image eimg ON eteam.registry = eimg.registry AND eteam.image_name = eimg.image_name
        LEFT JOIN external_image_tag etag ON eteam.registry = etag.registry AND eteam.image_name = etag.image_name AND eteam.image_tag = etag.image_tag
      WHERE eteam.team_id = $1
      ORDER BY eimg.created_at DESC, etag.created_at DESC
    `
    const result = await db.query(query, [teamId])

    // Group results by image (registry + image_name)
    const imageMap = new Map<string, TrackedExternalImage>()

    for (const row of result.rows) {
      const imageKey = `${row.registry}/${row.image_name}`

      if (!imageMap.has(imageKey)) {
        imageMap.set(imageKey, {
          registry: row.registry,
          imageName: row.image_name,
          imageTags: [],
          createdAt: row.created_at,
          hasX8664: false,
          hasArm64: false,
          tagCompletionStatus: {}
        })
      }

      // image_tag can be null because of the LEFT JOIN
      if (row.image_tag) {
        const image = imageMap.get(imageKey)!

        // Add tag if not already present
        if (!image.imageTags.includes(row.image_tag)) {
          image.imageTags.push(row.image_tag)
        }

        // Set completion status for this tag
        image.tagCompletionStatus[row.image_tag] = {
          digest: row.digest,
          isSbomComplete: row.is_sbom_complete,
          isScanComplete: row.is_scan_complete,
          isSignatureComplete: false,
          sbomStatus: row.sbom_status,
          scanStatus: row.scan_status
        }
      }
    }

    return Array.from(imageMap.values())
  } catch (err) {
    console.error(`listExternalImages error:`, err)
    throw new Error(`Failed to list external images: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }
}


export async function encryptPassword(password: string): Promise<string> {
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

export async function decryptPassword(encryptedPassword: string): Promise<string> {
  const secretEncoded = process.env.EXTERNAL_REGISTRY_ENCRYPTION_SECRET;
  if (!secretEncoded) {
    throw new Error("EXTERNAL_REGISTRY_ENCRYPTION_SECRET environment variable is required");
  }

  const secret = Buffer.from(secretEncoded, 'base64').toString('utf-8');

  // Decode the base64 combined data
  const combined = Buffer.from(encryptedPassword, 'base64');

  // Extract IV (first 12 bytes) and encrypted data
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  // Create a 32-byte key from the secret using SHA-256
  const keyBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));

  // Import the key for AES-GCM
  const key = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  // Decrypt the password
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    encrypted
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Get stored credentials for an external image from the database.
 * Returns decrypted credentials if found, or null if no credentials exist.
 *
 * @param teamId - The team ID to filter credentials by (prevents cross-team access)
 * @param registry - The registry (e.g., "docker.io", "ghcr.io")
 * @param imageName - The image name (e.g., "library/nginx")
 */
export async function getExternalImageCredentials(teamId: string, registry: string, imageName: string): Promise<{ username: string, password: string } | null> {
  const db = getDB(await getParam("DB_URI"))

  const query = `
    SELECT username, password
    FROM external_image_credential
    WHERE team_id = $1 AND registry = $2 AND image_name = $3
    LIMIT 1
  `
  const result = await db.query(query, [teamId, registry, imageName])

  if (result.rows.length === 0 || !result.rows[0].username || !result.rows[0].password) {
    return null
  }

  const decryptedPassword = await decryptPassword(result.rows[0].password)

  return {
    username: result.rows[0].username,
    password: decryptedPassword,
  }
}

export const getExternalImageSBOM = traceFunction('lib.externalimage.getExternalImageSBOM', async (digest: string): Promise<{ sbom: string, source: string } | null> => {
  try {
    const db = getDB(await getParam("DB_URI"))

    const query = `select sbom, source from external_image_sbom where digest = $1`
    const result = await db.query(query, [digest])

    if (result.rows.length === 0) {
      return null
    }

    return {
      sbom: result.rows[0].sbom,
      source: result.rows[0].source,
    }
  } catch (err) {
    console.error(`getExternalImageSBOM error:`, err)
    throw err;
  }
},
  {
    getTags: (digest: string) => ({
      'args.digest': digest,
    })
  })

/**
 * Gets the digest for a specific tag of an external image.
 * This is used when you need the exact digest for a particular tag,
 * rather than the most recently created tag's digest.
 *
 * @param teamId - The team ID to validate access against
 * @param registry - The registry hostname (e.g., "index.docker.io")
 * @param imageName - The image name (e.g., "library/busybox")
 * @param imageTag - The specific tag (e.g., "musl", "1.30")
 * @returns The digest for the specific tag, or null if not found
 */
export const getExternalImageDigestForTag = traceFunction('lib.externalimage.getExternalImageDigestForTag', async (teamId: string, registry: string, imageName: string, imageTag: string): Promise<string | null> => {
  try {
    const db = getDB(await getParam("DB_URI"))

    const query = `select t.digest
      from external_image_tag t
      inner join external_image_team et on et.team_id = $1 and et.registry = t.registry and et.image_name = t.image_name and et.image_tag = t.image_tag
      where t.registry = $2 and t.image_name = $3 and t.image_tag = $4`
    const result = await db.query(query, [teamId, registry, imageName, imageTag])

    if (result.rows.length === 0) {
      return null
    }

    return result.rows[0].digest
  } catch (err) {
    console.error(`getExternalImageDigestForTag error:`, err)
    throw err;
  }
},
  {
    getTags: (teamId: string, registry: string, imageName: string, imageTag: string) => ({
      'args.team_id': teamId,
      'args.registry': registry,
      'args.image_name': imageName,
      'args.image_tag': imageTag,
    })
  });

/**
 * Verify if a team has access to a specific digest.
 * This checks if the digest belongs to any image tag that the team has tracked.
 * @param teamId - The team ID to validate access
 * @param digest - The digest to check
 * @returns true if the team has access to this digest, false otherwise
 */
export const teamOwnsDigest = traceFunction('lib.externalimage.teamOwnsDigest', async (teamId: string, digest: string): Promise<boolean> => {
  try {
    const db = getDB(await getParam("DB_URI"))

    // Check if the digest belongs to any tag that the team has access to
    const query = `select 1
      from external_image_tag t
      inner join external_image_team et on et.team_id = $1 and et.registry = t.registry and et.image_name = t.image_name and et.image_tag = t.image_tag
      where t.digest = $2
      limit 1`
    const result = await db.query(query, [teamId, digest])

    return result.rows.length > 0
  } catch (err) {
    console.error(`teamOwnsDigest error:`, err)
    throw err;
  }
},
  {
    getTags: (teamId: string, digest: string) => ({
      'args.team_id': teamId,
      'args.digest': digest,
    })
  });

export type ExternalImageScanData = {
  scanResult: string | null
  scanCreatedAt: string
  digestFirstSeenAt: string | null
  imageSizeBytes: number
  status: string
  scanStatusMessage: string | null
  scanStatusUpdatedAt: Date | null
  scanAttemptedAt: Date | null
  scanCompletedAt: Date | null
  updatedAt: Date | null
  imageDigest: string | null
}

/**
 * Unified function to retrieve scan results with scan status metadata.
 * Uses LEFT JOIN with external_image_sbom so scan rows are visible even when
 * no SBOM row exists yet (e.g. race conditions, data integrity issues), ensuring
 * status-checking code sees queued/running scans and does not allow duplicate enqueues.
 *
 * @param digest - The image digest
 * @param arch - The architecture (x86_64 or aarch64)
 * @param format - The format: 'raw' for raw_result or 'parsed' for parsed_results_details
 * @returns Scan result with metadata including scan status fields; SBOM-derived fields may be null when no SBOM row exists. Throws on failure.
 */
export const getExternalImageScan = traceFunction('lib.externalimage.getExternalImageScan', async (digest: string, arch: string, format: 'raw' | 'parsed'): Promise<ExternalImageScanData | null> => {
  try {
    const db = getDB(await getParam("DB_URI"))

    let query: string
    if (format === 'raw') {
      query = `select escan.raw_result as scan_result, escan.created_at as scan_created_at, esbom.created_at as sbom_created_at, esbom.image_size_bytes as image_size_bytes,
        escan.status, escan.scan_status_message, escan.scan_status_updated_at, escan.scan_attempted_at, escan.scan_completed_at, escan.updated_at, esbom.image_digest
        from external_image_scan escan
        left join external_image_sbom esbom on escan.digest = esbom.digest and escan.arch = esbom.arch
        where escan.digest = $1 and escan.arch = $2`
    } else {
      // Use parsed_results_details (full structure with descriptor, fixed_counts, vulnerability_details)
      query = `select escan.parsed_results_details as scan_result, escan.created_at as scan_created_at, esbom.created_at as sbom_created_at, esbom.image_size_bytes as image_size_bytes,
        escan.status, escan.scan_status_message, escan.scan_status_updated_at, escan.scan_attempted_at, escan.scan_completed_at, escan.updated_at, esbom.image_digest
        from external_image_scan escan
        left join external_image_sbom esbom on escan.digest = esbom.digest and escan.arch = esbom.arch
        where escan.digest = $1 and escan.arch = $2`
    }

    const result = await db.query(query, [digest, arch])

    if (result.rows.length === 0) {
      return null
    }

    const row = result.rows[0]
    return {
      scanResult: row.scan_result,
      scanCreatedAt: row.scan_created_at,
      digestFirstSeenAt: row.sbom_created_at ?? null,
      imageSizeBytes: row.image_size_bytes != null ? parseInt(String(row.image_size_bytes), 10) : 0,
      status: row.status,
      scanStatusMessage: row.scan_status_message,
      scanStatusUpdatedAt: row.scan_status_updated_at,
      scanAttemptedAt: row.scan_attempted_at,
      scanCompletedAt: row.scan_completed_at,
      updatedAt: row.updated_at,
      imageDigest: row.image_digest ?? null,
    }
  } catch (err) {
    console.error(`getExternalImageScan error:`, err)
    throw new Error('Failed to retrieve scan results.')
  }
},
  {
    getTags: (digest: string, arch: string, format: 'raw' | 'parsed') => ({
      'args.digest': digest,
      'args.arch': arch,
      'args.format': format,
    })
  });


export const getExternalImageSbom = traceFunction('lib.externalimage.getExternalImageSbom', async (digest: string): Promise<string | null> => {
  try {
    const db = getDB(await getParam("DB_URI"))

    const query = `select sbom from external_image_sbom where digest = $1`
    const result = await db.query(query, [digest])

    if (result.rows.length === 0) {
      return null
    }

    return result.rows[0].sbom
  } catch (err) {
    console.error(`getExternalImageSbom error:`, err)
    throw err;
  }
},
  {
    getTags: (digest: string) => ({
      'args.digest': digest,
    })
  })

export async function unlinkExternalImage(teamId: string, registry: string, imageName: string) {
  console.log(`unlinkExternalImage: ${teamId} ${registry} ${imageName}`)
  try {
    const db = getDB(await getParam("DB_URI"))

    const query = `delete from external_image_team where team_id = $1 and registry = $2 and image_name = $3`
    await db.query(query, [teamId, registry, imageName])
  } catch (err) {
    console.error(`unlinkExternalImage error:`, err)
    throw err;
  }
}

export async function getExternalImageForTeam(teamId: string, registry: string, imageName: string): Promise<TrackedExternalImage> {
  console.log(`getExternalImageForTeam: ${registry} ${imageName} ${teamId}`)
  try {
    const db = getDB(await getParam("DB_URI"))

    // Single query that gets image info, all tags, and completion status by registry, imageName, and imageTag
    // Also gets the SBOM status (priority: failed > generating > pending > succeeded) and scan status (priority: failed > running > queued > succeeded)
    // Note: is_scan_complete requires status='succeeded' to prevent showing stale data during rescans
    const query = `
      SELECT DISTINCT
        eteam.registry,
        eteam.image_name,
        eimg.created_at,
        etag.image_tag,
        etag.digest,
        etag.created_at,
        EXISTS(SELECT 1 FROM external_image_sbom esbom WHERE esbom.digest = etag.digest) as is_sbom_complete,
        EXISTS(SELECT 1 FROM external_image_scan escan WHERE escan.digest = etag.digest AND escan.status = 'succeeded') as is_scan_complete,
        (
          SELECT CASE
            WHEN EXISTS(SELECT 1 FROM external_image_sbom_status esbom_status WHERE esbom_status.digest = etag.digest AND esbom_status.status = 'failed') THEN 'failed'
            WHEN EXISTS(SELECT 1 FROM external_image_sbom_status esbom_status WHERE esbom_status.digest = etag.digest AND esbom_status.status = 'generating') THEN 'generating'
            WHEN EXISTS(SELECT 1 FROM external_image_sbom_status esbom_status WHERE esbom_status.digest = etag.digest AND esbom_status.status = 'pending') THEN 'pending'
            WHEN EXISTS(SELECT 1 FROM external_image_sbom_status esbom_status WHERE esbom_status.digest = etag.digest AND esbom_status.status = 'succeeded') THEN 'succeeded'
            -- If SBOM exists but no status row, infer succeeded (for backwards compatibility with SBOMs created before status tracking)
            WHEN EXISTS(SELECT 1 FROM external_image_sbom esbom WHERE esbom.digest = etag.digest) THEN 'succeeded'
            ELSE NULL
          END
        ) as sbom_status,
        (
          SELECT CASE
            WHEN EXISTS(SELECT 1 FROM external_image_scan escan WHERE escan.digest = etag.digest AND escan.status = 'failed') THEN 'failed'
            WHEN EXISTS(SELECT 1 FROM external_image_scan escan WHERE escan.digest = etag.digest AND escan.status = 'running') THEN 'running'
            WHEN EXISTS(SELECT 1 FROM external_image_scan escan WHERE escan.digest = etag.digest AND escan.status = 'queued') THEN 'queued'
            WHEN EXISTS(SELECT 1 FROM external_image_scan escan WHERE escan.digest = etag.digest AND escan.status = 'succeeded') THEN 'succeeded'
            ELSE NULL
          END
        ) as scan_status
      FROM external_image_tag etag
        INNER JOIN external_image_team eteam ON etag.registry = eteam.registry
          AND etag.image_name = eteam.image_name
          AND etag.image_tag = eteam.image_tag
        INNER JOIN external_image eimg ON etag.registry = eimg.registry AND etag.image_name = eimg.image_name
      WHERE etag.registry = $1 AND etag.image_name = $2 AND eteam.team_id = $3
      ORDER BY etag.created_at DESC
    `
    const result = await db.query(query, [registry, imageName, teamId])

    if (result.rows.length === 0) {
      throw new Error(`External image not found for ${registry}/${imageName}`)
    }

    // Build the image object from the first row (all rows have same registry/image_name/created_at)
    const firstRow = result.rows[0]
    const image: TrackedExternalImage = {
      registry: firstRow.registry,
      imageName: firstRow.image_name,
      imageTags: [],
      createdAt: firstRow.created_at,
      hasX8664: false,
      hasArm64: false,
      tagCompletionStatus: {}
    }

    // Process all rows to build tags and completion status
    for (const row of result.rows) {
      // Add tag if not already present
      if (!image.imageTags.includes(row.image_tag)) {
        image.imageTags.push(row.image_tag)
      }

      // Set completion status for this tag
      image.tagCompletionStatus[row.image_tag] = {
        digest: row.digest,
        isSbomComplete: row.is_sbom_complete,
        isScanComplete: row.is_scan_complete,
        isSignatureComplete: false,
        sbomStatus: row.sbom_status,
        scanStatus: row.scan_status
      }
    }

    return image
  } catch (err) {
    console.error(`getExternalImageForTeam error:`, err)
    throw err;
  }
}

export async function getExternalImageLastScannedAt(digest: string): Promise<string | null> {
  try {
    const db = getDB(await getParam("DB_URI"))

    const query = `select max(scan_completed_at) as last_scanned_at from external_image_scan where digest = $1`
    const result = await db.query(query, [digest])

    if (result.rows.length === 0 || !result.rows[0].last_scanned_at) {
      return null
    }

    const parsedDate = parseUTCTimestamp(result.rows[0].last_scanned_at);
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      console.warn(`Invalid timestamp value for digest ${digest}: ${result.rows[0].last_scanned_at}`);
      return null;
    }
    return parsedDate.toISOString()
  } catch (err) {
    console.error(`getExternalImageLastScannedAt error:`, err)
    throw err;
  }
}

export async function getExternalImagePlatforms(digest: string): Promise<string[]> {
  try {
    const db = getDB(await getParam("DB_URI"))

    const query = `select distinct arch from external_image_scan where digest = $1 order by arch`
    const result = await db.query(query, [digest])

    const platforms = result.rows.map((row) => {
      const arch = row.arch
      if (arch === 'x86_64') {
        return 'linux/amd64'
      } else if (arch === 'aarch64') {
        return 'linux/arm64'
      } else {
        return `linux/${arch}`
      }
    })

    return platforms
  } catch (err) {
    console.error(`getExternalImagePlatforms error:`, err)
    throw err;
  }
}

// SBOM and Scan status types and functions
/**
 * SBOM status represents the state of SBOM generation for an external image.
 * Tracked separately from scan status in the external_image_sbom_status table.
 *
 * Status progression:
 * 1. pending: Image tracked, SBOM generation job not yet started
 * 2. generating: SBOM generation in progress (downloading from registry)
 * 3. succeeded: SBOM generated successfully
 * 4. failed: SBOM generation failed (see statusMessage for details)
 */
export type SBOMStatus = 'pending' | 'generating' | 'succeeded' | 'failed'

/**
 * Scan status represents the state of vulnerability scanning for an external image.
 * Tracked in the external_image_scan table. Scan can only start after SBOM generation succeeds.
 *
 * Status progression:
 * 1. queued: SBOM generated, waiting for vulnerability scan to start
 * 2. running: Vulnerability scan actively executing
 * 3. succeeded: Scan completed successfully with results
 * 4. failed: Scan failed with error (see scanStatusMessage for details)
 */
export type ScanStatus = 'unknown' | 'queued' | 'running' | 'succeeded' | 'failed'

export interface ScanStatusEntry {
  digest: string
  arch: string
  status: ScanStatus
  scanStatusMessage: string | null
  createdAt: Date
  updatedAt: Date | null
  scanAttemptedAt: Date | null
  scanCompletedAt: Date | null
  scanStatusUpdatedAt: Date | null
  imageDigest: string | null  // per-architecture manifest digest (from SBOM table)
}

export interface SBOMStatusEntry {
  digest: string
  status: SBOMStatus
  statusMessage: string | null
  createdAt: Date
  updatedAt: Date | null
  statusUpdatedAt: Date | null
}

/**
 * Reset scan status to queued for a digest.
 * This clears the scan_status_message and sets status to 'queued' so a rescan can run.
 * Note: scan_attempted_at is set when the scan actually starts (SetScanStatusRunning in Go).
 *
 * @param digest - The image digest to reset scan status for
 */
export async function resetScanStatus(digest: string): Promise<void> {
  const db = getDB(await getParam("DB_URI"))
  const now = new Date()

  // Only reset scan status for architectures that have SBOMs
  // This prevents resetting status for architectures the image doesn't support
  const resetQuery = `
    UPDATE external_image_scan eis
    SET scan_status_message = NULL, status = 'queued', updated_at = $2, scan_status_updated_at = $2
    WHERE eis.digest = $1
      AND EXISTS (
        SELECT 1 FROM external_image_sbom esbom
        WHERE esbom.digest = eis.digest AND esbom.arch = eis.arch
      )
  `
  await db.query(resetQuery, [digest, now])
}

/**
 * Update the digest for an existing tag.
 * This is used during rescan when the registry returns a new digest for a tag.
 *
 * @param registry - The registry (e.g., "docker.io", "ghcr.io")
 * @param imageName - The image name (e.g., "library/nginx")
 * @param imageTag - The image tag (e.g., "latest")
 * @param digest - The new digest from the registry
 */
export async function updateTagDigest(registry: string, imageName: string, imageTag: string, digest: string): Promise<void> {
  const db = getDB(await getParam("DB_URI"))

  // Set next check/scan times to 4 hours from now to prevent duplicate work
  // from the background monitor picking up this tag immediately
  const inFourHours = new Date(Date.now() + 4 * 60 * 60 * 1000)

  const query = `
    UPDATE external_image_tag
    SET digest = $4, next_check_digest_at = $5, next_scan_at = $5
    WHERE registry = $1 AND image_name = $2 AND image_tag = $3
  `
  const result = await db.query(query, [registry, imageName, imageTag, digest, inFourHours])

  if (result.rowCount === 0) {
    throw new Error(`Tag not found: ${registry}/${imageName}:${imageTag}`)
  }
}


/**
 * Initialize SBOM status as 'pending' for a digest.
 * Uses ON CONFLICT DO NOTHING to avoid overwriting existing status.
 * This should be called when an image is first tracked and SBOM work is enqueued.
 *
 * @param digest - The image digest to initialize status for
 */
export async function initializeSBOMStatusPending(digest: string): Promise<void> {
  const db = getDB(await getParam("DB_URI"))
  const now = new Date()

  const query = `
    INSERT INTO external_image_sbom_status (digest, created_at, status, updated_at, status_updated_at)
    VALUES ($1, $2, 'pending', $2, $2)
    ON CONFLICT (digest) DO NOTHING
  `

  await db.query(query, [digest, now])
}

/**
 * Get the SBOM status for a digest from the external_image_sbom_status table.
 *
 * @param digest - The image digest to check
 * @returns SBOM status entry or null if not found
 */
export async function getSBOMStatus(digest: string): Promise<SBOMStatusEntry | null> {
  const db = getDB(await getParam("DB_URI"))

  const query = `
    SELECT
      digest, status, status_message,
      created_at, updated_at, status_updated_at
    FROM external_image_sbom_status
    WHERE digest = $1
  `

  const result = await db.query(query, [digest])

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  return {
    digest: row.digest,
    status: row.status as SBOMStatus,
    statusMessage: row.status_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    statusUpdatedAt: row.status_updated_at,
  }
}

/**
 * Get the earliest scan_attempted_at timestamp for a digest.
 *
 * @param digest - The image digest to check
 * @returns The earliest scan_attempted_at timestamp, or null if not found
 */
export async function getScanAttemptedAt(digest: string): Promise<Date | null> {
  const db = getDB(await getParam("DB_URI"))

  const query = `
    SELECT MIN(scan_attempted_at) as scan_attempted_at
    FROM external_image_scan
    WHERE digest = $1
  `
  const result = await db.query(query, [digest])

  if (result.rows.length === 0 || !result.rows[0].scan_attempted_at) {
    return null
  }

  return result.rows[0].scan_attempted_at
}

export interface ImageRefTag {
  registry: string;
  repository: string;
  tag: string;
}

export interface BatchScanResult {
  digest: string;
  scanResult: string | null;
  scanCreatedAt: string | null;
  scanCompletedAt: string | null;
  digestFirstSeenAt: string | null;
  imageSizeBytes: number;
  hasAccess: boolean;
  scanStatus: string | null;
  scanStatusMessage: string | null;
  scanStatusUpdatedAt: string | null;
  sbomStatus: string | null;
  sbomStatusMessage: string | null;
  sbomStatusUpdatedAt: string | null;
}

export interface BatchSbomResult {
  digest: string;
  arch: string | null;
  sbom: string | null;
  source: string | null;
  sbomCreatedAt: string | null;
  imageSizeBytes: number;
  hasAccess: boolean;
}

/**
 * Batch query to get scan results for multiple image digests.
 * Only returns results for digests owned by the given team (via
 * external_image_team join on external_image_tag).
 *
 * @param teamId - Team ID for access validation
 * @param digests - Array of image digests to query
 * @param arch - Target architecture (x86_64 or aarch64)
 * @param format - Scan result format ('raw' or 'parsed')
 * @returns Map of digest to BatchScanResult (includes scan data, metadata, and access status)
 */
export const getBatchExternalImageScans = traceFunction('lib.externalimage.getBatchExternalImageScans', async (
  teamId: string,
  digests: string[],
  arch: string,
  format: 'raw' | 'parsed',
): Promise<Map<string, BatchScanResult>> => {
  try {
    const db = getDB(await getParam("DB_URI"))

    if (digests.length === 0) {
      return new Map()
    }

    // Select the appropriate result column based on format
    // parsed format uses parsed_results_details (full structure with descriptor, fixed_counts, vulnerability_details)
    const resultColumn = format === 'raw' ? 'escan.raw_result' : 'escan.parsed_results_details'

    // Phase 0: Determine which of the requested digests the team owns.
    // This must be checked from external_image_tag + external_image_team directly,
    // not inferred from scan query results — a digest the team owns may have no
    // scan row yet (SBOM still pending/generating).
    const ownershipQuery = `
      SELECT DISTINCT etag.digest
      FROM external_image_tag etag
        INNER JOIN external_image_team eteam
          ON eteam.team_id = $1
          AND eteam.registry = etag.registry
          AND eteam.image_name = etag.image_name
          AND eteam.image_tag = etag.image_tag
      WHERE etag.digest = ANY($2)
    `
    const ownershipResult = await db.query(ownershipQuery, [teamId, digests])
    const ownedDigests = new Set(ownershipResult.rows.map((r: { digest: string }) => r.digest))

    // Build a map of "digest" -> scan result
    const resultMap = new Map<string, BatchScanResult>()

    // Phase 1: Get scan results (with SBOM metadata and SBOM status) for owned digests only
    const ownedDigestList = [...ownedDigests]
    if (ownedDigestList.length > 0) {
      const scanQuery = `
        SELECT
          escan.digest,
          ${resultColumn} as scan_result,
          escan.created_at as scan_created_at,
          escan.scan_completed_at as scan_completed_at,
          esbom.created_at as digest_first_seen_at,
          esbom.image_size_bytes,
          escan.status as scan_status,
          escan.scan_status_message as scan_status_message,
          escan.scan_status_updated_at as scan_status_updated_at,
          esbom_status.status as sbom_status,
          esbom_status.status_message as sbom_status_message,
          esbom_status.status_updated_at as sbom_status_updated_at
        FROM external_image_scan escan
          LEFT JOIN external_image_sbom esbom
            ON esbom.digest = escan.digest
            AND esbom.arch = escan.arch
          LEFT JOIN external_image_sbom_status esbom_status
            ON esbom_status.digest = escan.digest
        WHERE
          escan.arch = $1
          AND escan.digest = ANY($2)
      `

      const scanResult = await db.query(scanQuery, [arch, ownedDigestList])

      // Process scan results
      for (const row of scanResult.rows) {
        resultMap.set(row.digest, {
          digest: row.digest,
          scanResult: row.scan_result,
          scanCreatedAt: row.scan_created_at,
          scanCompletedAt: row.scan_completed_at,
          digestFirstSeenAt: row.digest_first_seen_at,
          imageSizeBytes: parseInt(row.image_size_bytes || '0'),
          hasAccess: true,
          scanStatus: row.scan_status,
          scanStatusMessage: row.scan_status_message,
          scanStatusUpdatedAt: row.scan_status_updated_at,
          sbomStatus: row.sbom_status,
          sbomStatusMessage: row.sbom_status_message,
          sbomStatusUpdatedAt: row.sbom_status_updated_at,
        })
      }
    }

    // Phase 2: Get SBOM status for owned digests that don't have scan entries yet (pending/generating SBOM)
    const ownedDigestsWithoutScans = ownedDigestList.filter(d => !resultMap.has(d))
    if (ownedDigestsWithoutScans.length > 0) {
      const sbomStatusQuery = `
        SELECT
          esbom_status.digest,
          esbom_status.status as sbom_status,
          esbom_status.status_message as sbom_status_message,
          esbom_status.status_updated_at as sbom_status_updated_at
        FROM external_image_sbom_status esbom_status
        WHERE
          esbom_status.digest = ANY($1)
      `
      const sbomStatusResult = await db.query(sbomStatusQuery, [ownedDigestsWithoutScans])

      // Add SBOM status entries for digests without scan data yet
      for (const row of sbomStatusResult.rows) {
        resultMap.set(row.digest, {
          digest: row.digest,
          scanResult: null,
          scanCreatedAt: null,
          scanCompletedAt: null,
          digestFirstSeenAt: null,
          imageSizeBytes: 0,
          hasAccess: true,
          scanStatus: null,
          scanStatusMessage: null,
          scanStatusUpdatedAt: null,
          sbomStatus: row.sbom_status,
          sbomStatusMessage: row.sbom_status_message,
          sbomStatusUpdatedAt: row.sbom_status_updated_at,
        })
      }
    }

    // For image tags not found in the result (no access or doesn't exist),
    // add them with hasAccess: false
    for (const digest of digests) {
      if (!resultMap.has(digest)) {
        resultMap.set(digest, {
          digest: digest,
          scanResult: null,
          scanCreatedAt: null,
          scanCompletedAt: null,
          digestFirstSeenAt: null,
          imageSizeBytes: 0,
          hasAccess: false,
          scanStatus: null,
          scanStatusMessage: null,
          scanStatusUpdatedAt: null,
          sbomStatus: null,
          sbomStatusMessage: null,
          sbomStatusUpdatedAt: null,
        })
      }
    }

    return resultMap
  } catch (err) {
    console.error(`getBatchExternalImageScans error:`, err)
    throw err;
  }
},
  {
    getTags: (teamId: string, digests: string[], arch: string, format: 'raw' | 'parsed') => ({
      'args.team_id': teamId,
      'args.digests.length': digests.length,
      'args.arch': arch,
      'args.format': format,
    })
  })

/**
 * Batch query to get SBOM data for multiple image digests.
 * Only returns results for digests owned by the given team (via
 * external_image_team join on external_image_tag).
 *
 * @param teamId - Team ID for access validation
 * @param digests - Array of image digests to query
 * @param arch - Target architecture (x86_64 or aarch64)
 * @returns Map of digest to BatchSbomResult (includes SBOM data, metadata, and access status)
 */
export const getBatchExternalSboms = traceFunction('lib.externalimage.getBatchExternalSboms', async (
  teamId: string,
  digests: string[],
  arch: string
): Promise<Map<string, BatchSbomResult>> => {
  try {
    const db = getDB(await getParam("DB_URI"))

    if (digests.length === 0) {
      return new Map()
    }

    // Single query that:
    // 1. Queries external_image_sbom for SBOM data
    // 2. Filters by architecture and digest array
    // 3. Validates team access via external_image_team join
    // 4. Returns SBOM data and metadata for all requested digests in one query

    const query = `
      SELECT
        esbom.digest,
        esbom.arch,
        esbom.sbom,
        esbom.source,
        esbom.created_at as sbom_created_at,
        esbom.image_size_bytes
      FROM external_image_sbom esbom
        INNER JOIN external_image_tag etag
          ON etag.digest = esbom.digest
        INNER JOIN external_image_team eteam
          ON eteam.team_id = $1
          AND eteam.registry = etag.registry
          AND eteam.image_name = etag.image_name
          AND eteam.image_tag = etag.image_tag
      WHERE
        esbom.arch = $2
        AND esbom.digest = ANY($3)
    `

    const result = await db.query(query, [teamId, arch, digests])

    // Build a map of "digest" -> SBOM result
    const resultMap = new Map<string, BatchSbomResult>()

    for (const row of result.rows) {
      resultMap.set(row.digest, {
        digest: row.digest,
        arch: row.arch,
        sbom: row.sbom,
        source: row.source,
        sbomCreatedAt: row.sbom_created_at,
        imageSizeBytes: parseInt(row.image_size_bytes || '0'),
        hasAccess: true,
      })
    }

    // For image digests not found in the result (no access or doesn't exist),
    // add them with hasAccess: false
    for (const digest of digests) {
      if (!resultMap.has(digest)) {
        resultMap.set(digest, {
          digest: digest,
          arch: null,
          sbom: null,
          source: null,
          sbomCreatedAt: null,
          imageSizeBytes: 0,
          hasAccess: false,
        })
      }
    }

    return resultMap
  } catch (err) {
    console.error(`getBatchExternalSboms error:`, err)
    throw err;
  }
},
  {
    getTags: (teamId: string, digests: string[], arch: string) => ({
      'args.team_id': teamId,
      'args.digests.length': digests.length,
      'args.arch': arch,
    })
  })

/**
 * Batch query to get digests for multiple image reference tags.
 * Returns an array of digests in the same order as the input imageTags array.
 * For images that are not found or not accessible to the team, returns undefined.
 *
 * @param teamId - Team ID for access validation
 * @param imageTags - Array of image references (registry, repository, tag)
 * @returns Array of digests (undefined for not found/inaccessible images)
 */
export const getBatchDigestsForTags = traceFunction('lib.externalimage.getBatchDigestsForTags', async (
  teamId: string,
  imageTags: ImageRefTag[]
): Promise<(string | undefined)[]> => {
  try {
    const db = getDB(await getParam("DB_URI"))

    if (imageTags.length === 0) {
      return []
    }

    // Build arrays for the query
    const registries = imageTags.map(t => t.registry)
    const imageNames = imageTags.map(t => t.repository)
    const tags = imageTags.map(t => t.tag)

    // Single query that:
    // 1. Uses the primary key (registry, image_name, image_tag) for efficient lookup
    // 2. Validates team access via external_image_team join
    // 3. Returns digest for each accessible image tag
    const query = `
      SELECT
        etag.registry,
        etag.image_name,
        etag.image_tag,
        etag.digest
      FROM external_image_tag etag
      INNER JOIN external_image_team eteam
        ON eteam.team_id = $1
        AND eteam.registry = etag.registry
        AND eteam.image_name = etag.image_name
        AND eteam.image_tag = etag.image_tag
      WHERE (etag.registry, etag.image_name, etag.image_tag) IN (
        SELECT unnest($2::text[]), unnest($3::text[]), unnest($4::text[])
      )
    `

    const result = await db.query(query, [teamId, registries, imageNames, tags])

    // Build a map of "registry/repository:tag" -> digest
    const resultMap = new Map<string, string>()

    for (const row of result.rows) {
      const key = `${row.registry}/${row.image_name}:${row.image_tag}`
      resultMap.set(key, row.digest)
    }

    const resultArray = []

    // For image tags not found in the result (no access or doesn't exist),
    // add them with undefined digest
    for (const imgTag of imageTags) {
      const key = `${imgTag.registry}/${imgTag.repository}:${imgTag.tag}`
      resultArray.push(resultMap.get(key));
    }

    return resultArray
  } catch (err) {
    console.error(`getDigestsForImageRefTags error:`, err)
    throw err;
  }
},
  {
    getTags: (teamId: string, imageTags: ImageRefTag[]) => ({
      'args.team_id': teamId,
      'args.image_tags.length': imageTags.length,
    })
  })

export interface EnqueueScanResult {
  scanStartedAt: Date | null
  enqueued: boolean
}

/**
 * EnqueueScanForDigest triggers an on-demand scan for a digest if the existing
 * scan results are stale (older than 4 hours) or missing. Uses a transaction
 * with row locking (SELECT ... FOR UPDATE) on external_image_sbom and
 * external_image_scan to ensure atomicity and prevent duplicate enqueues.
 *
 * Steps (all inside one transaction):
 *  1. LEFT JOIN external_image_sbom to external_image_scan with FOR UPDATE
 *     — locks SBOM rows (must exist for a scan) and scan rows if they exist.
 *  2. Staleness check: if any arch is queued/running, or all arches were
 *     scanned within 4 hours, skip enqueue and return existing scan_attempted_at.
 *  3. If stale/missing: insert into work_queue + pg_notify, then upsert
 *     external_image_scan rows to 'queued' with a WHERE guard preventing
 *     overwriting rows already in 'queued' or 'running' status.
 *  4. Commit and return scan_attempted_at.
 *
 * @param digest - The image digest to scan
 * @returns { scanStartedAt, enqueued } — scanStartedAt is the scan_attempted_at
 *          timestamp (set to now() when enqueued, or existing value when not).
 *          enqueued is true if a new scan was triggered.
 */
export async function EnqueueScanForDigest(digest: string): Promise<EnqueueScanResult> {
  const db = getDB(await getParam("DB_URI"))

  // Step 1 (pre-transaction): Ensure scan rows exist for architectures that
  // have SBOMs. New rows get status='unknown' (no scan ever attempted).
  // ON CONFLICT DO NOTHING leaves existing rows untouched.
  // Only arches with SBOMs are queued — an arch without an SBOM would leave
  // a queued scan that can never be completed. Images may have one or both
  // architectures.
  const archResult = await db.query(
    `SELECT DISTINCT arch FROM external_image_sbom WHERE digest = $1`,
    [digest]
  )
  if (archResult.rows.length === 0) {
    throw new Error(`no SBOMs found for digest ${digest}`)
  }

  for (const row of archResult.rows) {
    await db.query(
      `INSERT INTO external_image_scan (digest, arch, created_at, status, updated_at, scan_status_updated_at)
       VALUES ($1, $2, $3, 'unknown', $3, $3)
       ON CONFLICT (digest, arch) DO NOTHING`,
      [digest, row.arch, new Date()]
    )
  }

  // Step 2 (transaction): Lock scan rows, check staleness, enqueue if needed.
  return withTransaction(db, async (client) => {
    const lockQuery = `
      SELECT digest, arch, status, scan_completed_at, scan_attempted_at
      FROM external_image_scan
      WHERE digest = $1
      FOR UPDATE
    `
    const lockResult = await client.query(lockQuery, [digest])

    // Step 3: Staleness check
    let hasInProgress = false
    let allRecent = true
    let existingScanAttemptedAt: Date | null = null
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000)

    for (const row of lockResult.rows) {
      const status = row.status
      const scanCompletedAt = row.scan_completed_at

      if (status === 'queued' || status === 'running') {
        hasInProgress = true
      }

      if (status === 'unknown' || !scanCompletedAt || new Date(scanCompletedAt) < fourHoursAgo) {
        allRecent = false
      }

      if (row.scan_attempted_at) {
        const attemptedAt = new Date(row.scan_attempted_at)
        if (!existingScanAttemptedAt || attemptedAt < existingScanAttemptedAt) {
          existingScanAttemptedAt = attemptedAt
        }
      }
    }

    if (hasInProgress || (allRecent && lockResult.rows.length > 0)) {
      return { scanStartedAt: existingScanAttemptedAt, enqueued: false }
    }

    // Step 4: Enqueue work + update scan rows to 'queued'
    const now = new Date()

    await enqueueWork('external_image_scan', { digest }, client)

    for (const row of lockResult.rows) {
      await client.query(
        `UPDATE external_image_scan
         SET status = 'queued',
             updated_at = $3,
             scan_attempted_at = $3,
             scan_status_updated_at = $3
         WHERE digest = $1 AND arch = $2 AND status NOT IN ('queued', 'running')`,
        [digest, row.arch, now]
      )
    }

    return { scanStartedAt: now, enqueued: true }
  })
}
