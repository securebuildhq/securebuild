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

/**
 * Lazily adopts usable SBOMs for the digests visible in an image listing.
 * Legacy status rows remain a read fallback; only stored per-architecture
 * evidence is promoted to a succeeded platform status.
 */
export async function adoptTrackedSBOMPlatformStatuses(
  db: Queryable,
  teamId: string,
  registry?: string,
  imageName?: string,
): Promise<void> {
  const result = await db.query(
    `SELECT DISTINCT tag.digest
     FROM external_image_team team
     INNER JOIN external_image_tag tag
       ON tag.registry = team.registry
      AND tag.image_name = team.image_name
      AND tag.image_tag = team.image_tag
     WHERE team.team_id = $1
       AND ($2::text IS NULL OR tag.registry = $2)
       AND ($3::text IS NULL OR tag.image_name = $3)
       AND tag.digest IS NOT NULL`,
    [teamId, registry ?? null, imageName ?? null],
  );

  await adoptStoredSBOMPlatformStatuses(
    db,
    result.rows.map((row: { digest: string }) => row.digest),
  );
}
