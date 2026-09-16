package buildpriority

// PackageMetadataJoin supplies the family and stored version key for a candidate
// with package_id and package_version_id columns. A missing version ID means the
// handler will build the latest version. The aggregates keep one row per job,
// including jobs whose package/version was deleted, so normal error handling runs.
// Aggregate families before joining to avoid scanning the mapping table per job.
// Callers coalesce the joined family to candidate.package_id, then an empty string.
const PackageMetadataJoin = `
	LEFT JOIN (
		SELECT package_id, MIN(package_family_id) AS family
		FROM package_family_package
		GROUP BY package_id
	) family_metadata ON family_metadata.package_id = candidate.package_id
	LEFT JOIN LATERAL (
		SELECT MAX(NULLIF(pv.version_sort_key, '') COLLATE "C") AS version_key
		FROM package_version pv
		WHERE pv.package_id = candidate.package_id
		AND (candidate.package_version_id IS NULL OR pv.id = candidate.package_version_id)
	) version_metadata ON true
`

// ImageMetadataJoin uses version tags on the APKO, not the mutable spec or build
// timestamps. Multiple aliases for a version share the same stored key.
const ImageMetadataJoin = `
	LEFT JOIN image_apko ia ON ia.id = candidate.apko_id
`
