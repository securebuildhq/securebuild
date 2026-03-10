package image

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/notification"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
)

func GetImageCatalogItem(ctx context.Context, id string) (*types.ImageCatalogItem, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id, name, tag, created_at, updated_at, sbom_x86, is_published, index_digest, apko_id from image_catalog where id = $1`
	row := conn.QueryRow(ctx, query, id)

	var imageCatalogItem types.ImageCatalogItem
	var sbom sql.NullString
	var indexDigest sql.NullString
	if err := row.Scan(&imageCatalogItem.ID, &imageCatalogItem.Name, &imageCatalogItem.Tag, &imageCatalogItem.CreatedAt, &imageCatalogItem.UpdatedAt, &sbom, &imageCatalogItem.IsPublished, &indexDigest, &imageCatalogItem.APKOId); err != nil {
		return nil, err
	}
	if sbom.Valid {
		imageCatalogItem.SBOM = sbom.String
	} else {
		imageCatalogItem.SBOM = ""
	}
	if indexDigest.Valid {
		imageCatalogItem.IndexDigest = indexDigest.String
	} else {
		imageCatalogItem.IndexDigest = ""
	}

	return &imageCatalogItem, nil
}

func GetImageCatalogID(ctx context.Context, imageName string, tag string) (string, error) {
	logger.Debugf("getting image catalog id for %s %s", imageName, tag)
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id from image_catalog where name = $1 and tag = $2 and is_published = true`

	var id string
	if err := conn.QueryRow(ctx, query, imageName, tag).Scan(&id); err != nil {
		if err == pgx.ErrNoRows {
			return "", ErrImageNotFound
		}
		return "", err
	}

	return id, nil
}

func CreateCatalogImage(ctx context.Context, name string, tag string, sbomX86 string, sbomAarch64 string, imageID string, apkoID string, apkoVersionID string,
	sizeX86 int64, sizeAarch64 int64, digestX86 string, digestAarch64 string, indexDigest string,
	scanAt time.Time, scanResultX86 string, scanResultAarch64 string,
	customScanResultX86 string, customScanResultAarch64 string,
	alternateScanResultX86 string, alternateScanResultAarch64 string,
	readme *string,
) (string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	fixedCVECountX86, err := CountFixedCVEs(ctx, scanResultX86, alternateScanResultX86)
	if err != nil {
		return "", err
	}
	fixedCVECountAarch64, err := CountFixedCVEs(ctx, scanResultAarch64, alternateScanResultAarch64)
	if err != nil {
		return "", err
	}

	id, err := securerandom.Hex(24)
	if err != nil {
		return "", err
	}

	id = "ic_" + id

	query := `
		INSERT INTO image_catalog (
			id, name, tag, created_at, updated_at,
			sbom_x86, sbom_aarch64,
			image_id, apko_id, apko_version_id,
			is_published,
			size_x86, size_aarch64,
			digest_x86, digest_aarch64, index_digest,
			last_scanned_at, last_scan_result_x86, last_scan_result_aarch64,
			last_scan_result_custom_x86, last_scan_result_custom_aarch64,
			next_scan_at,
			last_scan_result_alternate_x86, last_scan_result_alternate_aarch64,
			fixed_cve_count_x86, fixed_cve_count_aarch64,
			readme
		) VALUES (
			$1, $2, $3, now(), now(),
			$4, $5,
			$6, $7, $8,
			false,
			$9, $10,
			$11, $12, $13,
			$14, $15, $16,
			$17, $18,
			$19,
			$20, $21,
			$22, $23,
			$24
		)`

	_, err = conn.Exec(ctx, query,
		id, name, tag, // $1, $2, $3
		sbomX86, sbomAarch64, // $4, $5
		imageID, apkoID, apkoVersionID, // $6, $7, $8
		sizeX86, sizeAarch64, // $9, $10
		digestX86, digestAarch64, indexDigest, // $11, $12, $13
		scanAt, scanResultX86, scanResultAarch64, // $14, $15, $16
		customScanResultX86, customScanResultAarch64, // $17, $18
		scanAt.Add(4*time.Hour),                            // $19
		alternateScanResultX86, alternateScanResultAarch64, // $20, $21
		fixedCVECountX86, fixedCVECountAarch64, // $22, $23
		readme, // $24
	)
	if err != nil {
		return "", err
	}

	return id, nil
}

func StoreImagePackages(ctx context.Context, imageID string, apkoID string, packages []types.APKPackageVersion) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Get package IDs and pinned versions before starting the transaction
	type pkgInfo struct {
		packageID     string
		pinnedVersion string
	}
	packageMap := make(map[string]pkgInfo)
	for _, pkg := range packages {
		info, err := sbpackage.GetPackageAndVersionIDs(ctx, tx, pkg.Name, pkg.Version, pkg.Release)
		if err != nil {
			return fmt.Errorf("failed to get package info for %s: %w", pkg.Name, err)
		}
		if info.PackageID == "" {
			// Package not found - log as error but continue
			logger.Warn("package not found in database",
				zap.String("package", pkg.Name),
				zap.String("image", imageID),
				zap.String("apko", apkoID))
			continue
		}
		// Store the package info with pinned version if available
		packageMap[info.PackageID] = pkgInfo{
			packageID:     info.PackageID,
			pinnedVersion: pkg.PinnedVersion,
		}
	}

	// Delete existing mappings for this image
	deleteQuery := `DELETE FROM image_package WHERE image_id = $1 AND apko_id = $2`
	_, err = tx.Exec(ctx, deleteQuery, imageID, apkoID)
	if err != nil {
		return fmt.Errorf("failed to delete existing image-package mappings: %w", err)
	}

	for _, info := range packageMap {
		var pinnedVersion sql.NullString
		if info.pinnedVersion != "" {
			pinnedVersion = sql.NullString{String: info.pinnedVersion, Valid: true}
		}

		query := `
			INSERT INTO image_package (image_id, apko_id, package_id, pinned_version)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (apko_id, package_id) DO UPDATE
			SET pinned_version = EXCLUDED.pinned_version
		`
		_, err = tx.Exec(ctx, query, imageID, apkoID, info.packageID, pinnedVersion)
		if err != nil {
			return fmt.Errorf("failed to insert image-package mapping: %w", err)
		}
	}

	return tx.Commit(ctx)
}

func PublishCatalogImage(ctx context.Context, name string, ids []string, apkoID string) error {
	logger.Debug("publishing image", zap.String("name", name), zap.Strings("ids", ids))
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// BEFORE unpublishing, capture what catalog items are currently published for this APKO
	previouslyPublishedImage, err := getPreviouslyPublishedImages(ctx, tx, name, apkoID)
	if err != nil {
		return fmt.Errorf("failed to get previously published images: %w", err)
	}

	query := `update image_catalog set is_published = false where name = $1 and apko_id = $2`
	_, err = tx.Exec(ctx, query, name, apkoID)
	if err != nil {
		return err
	}

	query = `update image_catalog set is_published = true where name = $1 and id = any($2)`
	_, err = tx.Exec(ctx, query, name, ids)
	if err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// AFTER successful publishing, queue notifications for each newly published catalog item
	for _, catalogID := range ids {
		catalogItem, err := GetImageCatalogItem(ctx, catalogID)
		if err != nil {
			logger.Warn("failed to get catalog item for notifications",
				zap.String("id", catalogID),
				zap.Error(err))
			continue
		}

		eventType := notification.EventNewTag
		var previousDigest *string

		// Check if this tag was previously published (making it an update)
		if oldItem, exists := previouslyPublishedImage[catalogItem.Tag]; exists {
			eventType = notification.EventTagUpdated
			if oldItem.IndexDigest != "" {
				previousDigest = &oldItem.IndexDigest
			}
		}

		// Queue notification event
		if err := notification.QueueNotificationEvent(ctx, catalogItem.Name, catalogItem.Tag,
			catalogItem.IndexDigest, eventType, previousDigest); err != nil {
			logger.Warn("failed to queue notification event",
				zap.String("image", catalogItem.Name),
				zap.String("tag", catalogItem.Tag),
				zap.String("eventType", eventType),
				zap.Error(err))
		} else {
			logger.Debug("queued notification event",
				zap.String("image", catalogItem.Name),
				zap.String("tag", catalogItem.Tag),
				zap.String("eventType", eventType))
		}
	}

	return nil
}

// getPreviouslyPublishedImages returns a map of tag -> catalog item for all currently published catalog items of the given image and APKO
func getPreviouslyPublishedImages(ctx context.Context, tx pgx.Tx, imageName string, apkoID string) (map[string]*types.ImageCatalogItem, error) {
	query := `
		SELECT id, name, tag, created_at, updated_at, sbom_x86, is_published, index_digest, apko_id
		FROM image_catalog
		WHERE name = $1 AND apko_id = $2 AND is_published = true`

	rows, err := tx.Query(ctx, query, imageName, apkoID)
	if err != nil {
		return nil, fmt.Errorf("failed to query previously published image: %w", err)
	}
	defer rows.Close()

	publishedItems := make(map[string]*types.ImageCatalogItem)
	for rows.Next() {
		var item types.ImageCatalogItem
		var sbom sql.NullString
		var indexDigest sql.NullString

		err := rows.Scan(&item.ID, &item.Name, &item.Tag, &item.CreatedAt,
			&item.UpdatedAt, &sbom, &item.IsPublished, &indexDigest, &item.APKOId)
		if err != nil {
			return nil, fmt.Errorf("failed to scan previously published catalog item: %w", err)
		}

		if sbom.Valid {
			item.SBOM = sbom.String
		}
		if indexDigest.Valid {
			item.IndexDigest = indexDigest.String
		}

		publishedItems[item.Tag] = &item
	}

	return publishedItems, nil
}

// GetAPKOsDependingOnPackage returns a list of APKO IDs that depend on the given package and version.
// Returns APKOs that either have the exact version pinned OR have no version pinned at all.
// For subpackages, it also checks APKOs that depend on the parent package.
func GetAPKOsDependingOnPackage(ctx context.Context, packageID string, version string) ([]string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// First, get the package info to check if it's a subpackage
	var parentID sql.NullString
	err := conn.QueryRow(ctx, `SELECT parent_id FROM package WHERE id = $1`, packageID).Scan(&parentID)
	if err != nil {
		return nil, fmt.Errorf("failed to get package info: %w", err)
	}

	// Build the query to find APKOs that depend on either:
	// 1. This package with matching version or no version pinned
	// 2. If this is a subpackage, the parent package with matching version or no version pinned
	query := `
		SELECT DISTINCT apko_id
		FROM image_package
		WHERE (package_id = $1 OR ($2::text IS NOT NULL AND package_id = $2))
		AND (pinned_version = $3 OR pinned_version IS NULL)
	`

	rows, err := conn.Query(ctx, query, packageID, parentID, version)
	if err != nil {
		return nil, fmt.Errorf("failed to query APKOs depending on package: %w", err)
	}
	defer rows.Close()

	var apkoIDs []string
	for rows.Next() {
		var apkoID string
		if err := rows.Scan(&apkoID); err != nil {
			return nil, fmt.Errorf("failed to scan APKO ID: %w", err)
		}
		logger.Debug("Found APKO depending on package",
			zap.String("apkoID", apkoID),
			zap.String("packageID", packageID),
			zap.String("parentID", parentID.String))
		apkoIDs = append(apkoIDs, apkoID)
	}

	return apkoIDs, nil
}
