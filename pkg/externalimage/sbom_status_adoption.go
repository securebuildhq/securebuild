package externalimage

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
)

const adoptStoredSBOMPlatformStatusesQuery = `
	INSERT INTO external_image_sbom_platform_status
		(digest, arch, status, status_message, created_at, updated_at, status_updated_at)
	SELECT sbom.digest, sbom.arch, 'succeeded', NULL,
	       sbom.created_at, sbom.created_at, sbom.created_at
	FROM external_image_sbom sbom
	WHERE sbom.digest = $1
	  AND sbom.is_in_object_store = true
	ON CONFLICT (digest, arch) DO NOTHING
`

type sbomStatusExecer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

// adoptStoredSBOMPlatformStatuses records successful platform state only when
// the corresponding SBOM is known to be usable. Existing platform state always
// wins so lazy adoption cannot overwrite live or retried work.
func adoptStoredSBOMPlatformStatuses(ctx context.Context, db sbomStatusExecer, digest string) error {
	if _, err := db.Exec(ctx, adoptStoredSBOMPlatformStatusesQuery, digest); err != nil {
		return fmt.Errorf("adopt stored SBOM platform statuses for digest %s: %w", digest, err)
	}
	return nil
}
