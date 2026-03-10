import { getDB } from "@/lib/data/db"
import { getParam } from "@/lib/data/param"

/**
 * Returns true if a cosign signature artifact exists for the given image name and tag.
 */
export async function hasCosignSignature(imageName: string, tag: string): Promise<boolean> {
  // Returns true only when a *key-less* cosign signature exists for the given image+tag.
  // Key-less signatures are the ones verified with the OIDC email + issuer flags we put
  // in the generated command.  They are identified by the custom annotation
  //   dev.cosignproject.cosign/keyless = "true"
  const db = getDB(await getParam("DB_URI"))
  const query = `
    SELECT 1
    FROM oci_artifact_manifest m
    JOIN image_catalog c ON c.id = m.image_catalog_id
    JOIN image i ON i.id = c.image_id
    WHERE i.name = $1
      AND c.tag  = $2
      AND m.artifact_type = 'application/vnd.dev.cosign.simplesigning.v1+json'
      AND (m.annotations ->> 'dev.cosignproject.cosign/keyless') = 'true'
    LIMIT 1`;
  const result = await db.query(query, [imageName, tag])
  return result.rows.length > 0
} 