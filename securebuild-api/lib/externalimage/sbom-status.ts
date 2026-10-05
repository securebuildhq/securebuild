import type { QueryResult } from 'pg';

interface Queryable {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

/**
 * Lazily records per-platform success for legacy SBOMs that are known to exist
 * in object storage. Existing platform state always wins.
 */
export async function adoptStoredSBOMPlatformStatuses(
  db: Queryable,
  digests: string | string[],
): Promise<void> {
  const digestList = Array.isArray(digests) ? digests : [digests];
  if (digestList.length === 0) return;

  await db.query(
    `INSERT INTO external_image_sbom_platform_status
       (digest, arch, status, status_message, created_at, updated_at, status_updated_at)
     SELECT sbom.digest, sbom.arch, 'succeeded', NULL,
            sbom.created_at, sbom.created_at, sbom.created_at
     FROM external_image_sbom sbom
     WHERE sbom.digest = ANY($1::text[])
       AND sbom.is_in_object_store = true
     ON CONFLICT (digest, arch) DO NOTHING`,
    [digestList],
  );
}
