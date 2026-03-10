"use server"

import { getDB } from "@/lib/data/db"
import { getParam } from "@/lib/data/param"

/**
 * Returns the manifest digest (sha256:...) for the given image name, tag and arch.
 * If not found, returns undefined.
 */
export async function getImageDigest(imageName: string, tag: string, arch: string): Promise<string | undefined> {
  const db = getDB(await getParam("DB_URI"))

  // Map arch to the correct column name in image_catalog
  let digestColumn: string
  switch (arch) {
    case "x86_64":
      digestColumn = "digest_x86"
      break
    case "aarch64":
    case "arm64": // alias
      digestColumn = "digest_aarch64"
      break
    default:
      // Unsupported architecture column
      return undefined
  }

  const query = `
    SELECT ${digestColumn} AS digest, index_digest
    FROM image_catalog ic
    JOIN image i ON i.id = ic.image_id
    WHERE i.name = $1
      AND ic.tag = $2
      AND ic.is_published = true
      AND (${digestColumn} IS NOT NULL OR index_digest IS NOT NULL)
    ORDER BY ic.updated_at DESC
    LIMIT 1`;

  const result = await db.query(query, [imageName, tag])
  if (result.rows.length === 0) return undefined
  const row = result.rows[0]
  return (row.digest as string | null) ?? (row.index_digest as string | undefined)
} 