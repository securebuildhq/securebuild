package buildpriority

// PackageMetadataJoin supplies the family and upstream versions for a candidate
// with package_id and package_version_id columns. A missing version ID means the
// handler will build the latest version. Lateral aggregates keep one row per job,
// including jobs whose package/version was deleted, so normal error handling runs.
const PackageMetadataJoin = `
	LEFT JOIN LATERAL (
		SELECT COALESCE(MIN(pfp.package_family_id), candidate.package_id, '') AS family
		FROM package_family_package pfp WHERE pfp.package_id = candidate.package_id
	) family_metadata ON true
	LEFT JOIN LATERAL (
		SELECT ARRAY_AGG(DISTINCT pv.version) AS versions
		FROM package_version pv
		WHERE pv.package_id = candidate.package_id
		AND (candidate.package_version_id IS NULL OR pv.id = candidate.package_version_id)
	) version_metadata ON true
`

// ImageMetadataJoin uses version tags on the APKO, not the mutable spec or build
// timestamps. Multiple aliases for a version are ranked together by Order.
const ImageMetadataJoin = `
	LEFT JOIN image_apko ia ON ia.id = candidate.apko_id
`
