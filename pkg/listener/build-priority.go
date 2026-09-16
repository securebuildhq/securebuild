package listener

import "github.com/securebuildhq/securebuild/pkg/buildpriority"

// buildOrderCTE ranks the entire eligible backlog inside the atomic claim query.
// It returns no metadata to Go and applies no limit until after version ranking.
func buildOrderCTE(channel string) string {
	var metadata, joins string
	switch channel {
	case "build_package":
		metadata = "COALESCE(family_metadata.family, candidate.package_id, '') AS family, version_metadata.version_key"
		joins = buildpriority.PackageMetadataJoin
	case "build_apko":
		metadata = `ia.image_id AS family, CASE WHEN ia.version_sort_tags = ia.tags THEN NULLIF(ia.version_sort_key, '') END AS version_key`
		joins = buildpriority.ImageMetadataJoin
	default:
		return ""
	}
	return `candidate AS (
		SELECT id,
			payload->>'packageId' AS package_id,
			NULLIF(payload->>'packageVersionId', '') AS package_version_id,
			payload->>'apkoId' AS apko_id
		FROM work_queue
		WHERE channel = $1 AND completed_at IS NULL
		AND COALESCE(next_attempt_at, created_at) <= NOW()
		AND (processing_started_at IS NULL OR processing_started_at < NOW() - $2::interval)
	), metadata AS (
		SELECT candidate.id, ` + metadata + ` FROM candidate ` + joins + `
	), build_order AS MATERIALIZED (
		SELECT id, ` + buildpriority.VersionRank + ` AS version_rank FROM metadata
	), `
}
