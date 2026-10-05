package externalimage

import (
	"context"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

// BackfillSBOMPlatformStatuses conservatively reconstructs per-platform state.
// Live platform rows always win. A successful state is created only when a
// usable SBOM exists for that exact digest and architecture.
func BackfillSBOMPlatformStatuses(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin SBOM platform status backfill: %w", err)
	}
	defer tx.Rollback(ctx)

	successes, err := tx.Exec(ctx, `
		INSERT INTO external_image_sbom_platform_status
			(digest, arch, status, status_message, created_at, updated_at, status_updated_at)
		SELECT sbom.digest, sbom.arch, 'succeeded', NULL,
		       sbom.created_at, sbom.created_at, sbom.created_at
		FROM external_image_sbom sbom
		WHERE sbom.is_in_object_store = true
		ON CONFLICT (digest, arch) DO NOTHING
	`)
	if err != nil {
		return fmt.Errorf("backfill successful SBOM platform statuses: %w", err)
	}

	legacy, err := tx.Exec(ctx, `
		INSERT INTO external_image_sbom_platform_status
			(digest, arch, status, status_message, created_at, updated_at, status_updated_at)
		SELECT old.digest, target.arch, old.status, old.status_message,
		       old.created_at, old.updated_at, old.status_updated_at
		FROM external_image_sbom_status old
		CROSS JOIN (VALUES ('x86_64'), ('aarch64')) AS target(arch)
		WHERE old.status <> 'succeeded'
		  AND NOT EXISTS (
			SELECT 1 FROM external_image_sbom sbom
			WHERE sbom.digest = old.digest AND sbom.arch = target.arch
			  AND sbom.is_in_object_store = true
		  )
		ON CONFLICT (digest, arch) DO NOTHING
	`)
	if err != nil {
		return fmt.Errorf("backfill legacy SBOM platform statuses: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit SBOM platform status backfill: %w", err)
	}
	logger.Infof("Backfilled %d successful and %d legacy SBOM platform statuses", successes.RowsAffected(), legacy.RowsAffected())
	return nil
}
