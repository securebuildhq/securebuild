package listener

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/image"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/registry"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"go.uber.org/zap"
)

type ScanCatalogImagePayload struct {
	CatalogImageID string `json:"catalogImageId"` // ID from image_catalog table
	ImageName      string `json:"imageName"`
	ImageTag       string `json:"imageTag"`
}

func handleScanCatalogImage(ctx context.Context, payload string) error {
	var scanPayload ScanCatalogImagePayload
	if err := json.Unmarshal([]byte(payload), &scanPayload); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}

	logger.Info("scanning catalog image",
		zap.String("catalogImageID", scanPayload.CatalogImageID),
		zap.String("imageName", scanPayload.ImageName),
		zap.String("imageTag", scanPayload.ImageTag))

	// Get catalog image with SBOMs and APKO ID from database
	catalogImage, err := getCatalogImageForScan(ctx, scanPayload.CatalogImageID)
	if err != nil {
		return fmt.Errorf("failed to get catalog image: %w", err)
	}

	// Run both scans in parallel for better performance
	logger.Info("scanning SBOMs with both standard and custom Grype databases",
		zap.String("catalogImageID", scanPayload.CatalogImageID))

	var standardScanResults, customScanResults map[string]string
	var standardErr, customErr error
	var wg sync.WaitGroup

	wg.Add(2)

	// Scan 1: Standard database (includes SecureOS provider) for WWW display
	// This will show vulnerabilities with SecureBuild fixes applied
	go func() {
		defer wg.Done()
		standardScanResults, standardErr = scan.ScanCatalogImageSBOMsStandard(ctx, catalogImage.SbomX86, catalogImage.SbomAarch64)
	}()

	// Scan 2: Custom database (NO SecureOS provider) for SecDB feed generation
	// This uses only NVD + GitHub to avoid circular dependency
	go func() {
		defer wg.Done()
		customScanResults, customErr = scan.ScanCatalogImageSBOMsCustom(ctx, catalogImage.SbomX86, catalogImage.SbomAarch64)
	}()

	wg.Wait()

	if standardErr != nil {
		return fmt.Errorf("failed to scan SBOMs with standard database: %w", standardErr)
	}
	if customErr != nil {
		return fmt.Errorf("failed to scan SBOMs with custom database: %w", customErr)
	}

	// Update image_catalog with both STANDARD and CUSTOM scan results
	// Standard results (with SecureOS provider) for WWW display
	// Custom results (without SecureOS provider) for record-keeping
	if err := updateCatalogScanResults(ctx, scanPayload.CatalogImageID, standardScanResults); err != nil {
		return fmt.Errorf("failed to update scan results: %w", err)
	}

	// Populate cve_package_fix table with CUSTOM scan results (for SecDB feed)
	// This uses only NVD + GitHub data to avoid circular dependency
	if catalogImage.ApkoID != "" && customScanResults["x86_64"] != "" && catalogImage.SbomX86 != "" {
		if err := saveVulnerabilityFeedData(ctx, catalogImage.ApkoID, customScanResults["x86_64"], catalogImage.SbomX86); err != nil {
			// Log error but don't fail the scan
			logger.Errorf("failed to save vulnerability feed data (apkoID: %s): %v", catalogImage.ApkoID, err)
		}
	}

	logger.Info("Successfully updated catalog image scan results",
		zap.String("catalogImageID", scanPayload.CatalogImageID),
		zap.String("imageName", scanPayload.ImageName),
		zap.String("imageTag", scanPayload.ImageTag),
		zap.Int("architectures", len(standardScanResults)))

	return nil
}

type catalogImageSBOMs struct {
	ApkoID      string
	SbomX86     string
	SbomAarch64 string
}

func getCatalogImageForScan(ctx context.Context, catalogImageID string) (*catalogImageSBOMs, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// SBOM data may be missing from the database for old catalog images. We need to generate them on-demand.
	query := `
		SELECT c.apko_id, c.name, c.tag, s.syft_sbom_x86, s.syft_sbom_aarch64
		FROM image_catalog c
		LEFT JOIN image_sbom s ON s.image_apko_id = c.apko_id
		WHERE c.id = $1`

	var apkoID, imageName, imageTag string
	var storedSbomX86, storedSbomAarch64 sql.NullString
	err := conn.QueryRow(ctx, query, catalogImageID).Scan(&apkoID, &imageName, &imageTag, &storedSbomX86, &storedSbomAarch64)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, NewNonRetryableError(fmt.Errorf("catalog image id: %s not found (likely deleted)", catalogImageID))
		}
		return nil, fmt.Errorf("failed to get catalog image info: %w", err)
	}

	sbomX86 := storedSbomX86.String
	sbomAarch64 := storedSbomAarch64.String
	registryURL := registry.ImageRefWithTag(param.GetParam(ctx).RegistryImagePrefix, imageName, imageTag)
	sbomNeedsSaving := false

	if sbomX86 == "" {
		sbomX86, err = image.GenerateSBOM(ctx, registryURL, "x86_64")
		if err != nil {
			logger.Errorf("Failed to generate x86 SBOM",
				zap.String("catalogImageID", catalogImageID),
				zap.String("registryURL", registryURL),
				zap.Error(err))
		} else {
			sbomNeedsSaving = true
		}
	}

	if sbomAarch64 == "" {
		sbomAarch64, err = image.GenerateSBOM(ctx, registryURL, "aarch64")
		if err != nil {
			logger.Errorf("Failed to generate aarch64 SBOM",
				zap.String("catalogImageID", catalogImageID),
				zap.String("registryURL", registryURL),
				zap.Error(err))
		} else {
			sbomNeedsSaving = true
		}
	}

	// Save generated SBOMs to database if we generated at least one
	if sbomNeedsSaving {
		if err := image.SaveImageSBOMs(ctx, apkoID, sbomX86, sbomAarch64); err != nil {
			logger.Warn("Failed to save generated SBOMs",
				zap.String("catalogImageID", catalogImageID),
				zap.String("apkoID", apkoID),
				zap.Error(err))
			// Don't fail the scan - we can still use the generated SBOMs even if save failed
		}
	}

	result := &catalogImageSBOMs{
		ApkoID:      apkoID,
		SbomX86:     sbomX86,
		SbomAarch64: sbomAarch64,
	}

	return result, nil
}

func updateCatalogScanResults(ctx context.Context, catalogImageID string, standardScanResults map[string]string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now().UTC()

	// Get catalog image info to find the alternate image and tag
	var imageName, imageTag, alternateImageName string
	catalogQuery := `
		SELECT ic.name, ic.tag, i.alternate_image
		FROM image_catalog ic
		JOIN image i ON ic.image_id = i.id
		WHERE ic.id = $1`
	err := conn.QueryRow(ctx, catalogQuery, catalogImageID).Scan(&imageName, &imageTag, &alternateImageName)
	if err != nil {
		if err == pgx.ErrNoRows {
			// Catalog image or its parent image was deleted
			return NewNonRetryableError(fmt.Errorf("catalog image id: %s not found (likely deleted)", catalogImageID))
		}
		return fmt.Errorf("failed to get catalog image info: %w", err)
	}

	// Update scan results for each architecture
	for arch, standardScanResult := range standardScanResults {
		// Parse standard scan results to get vulnerability counts
		parsedResults, err := image.ParseScanResultDetails(standardScanResult)
		if err != nil {
			logger.Warn("failed to parse scan result",
				zap.String("arch", arch),
				zap.Error(err))
			continue
		}

		// Get alternate scan result from last_image_scan table
		alternateScanResult := ""
		if alternateImageName != "" {
			_, alternateScanResult, err = image.GetFixedCVEsFromLastScan(ctx, alternateImageName, imageTag, arch, standardScanResult)
			if err != nil {
				logger.Warn("failed to get alternate scan result",
					zap.String("catalogImageID", catalogImageID),
					zap.String("arch", arch),
					zap.String("alternateImage", alternateImageName),
					zap.String("imageTag", imageTag),
					zap.Error(err))
				// Continue with empty alternate result if retrieval fails
			}
		}

		// Update the appropriate architecture-specific fields
		// Use CASE to only update scan results when non-empty (preserves existing data on partial failures)
		var updateQuery string
		switch arch {
		case "x86_64":
			updateQuery = `
				UPDATE image_catalog
				SET last_scan_result_x86 = CASE WHEN $2 != '' THEN $2 ELSE last_scan_result_x86 END,
				    last_scan_result_alternate_x86 = CASE WHEN $3 != '' THEN $3 ELSE last_scan_result_alternate_x86 END,
				    last_scanned_at = $4
				WHERE id = $1`
		case "aarch64":
			updateQuery = `
				UPDATE image_catalog
				SET last_scan_result_aarch64 = CASE WHEN $2 != '' THEN $2 ELSE last_scan_result_aarch64 END,
				    last_scan_result_alternate_aarch64 = CASE WHEN $3 != '' THEN $3 ELSE last_scan_result_alternate_aarch64 END,
				    last_scanned_at = $4
				WHERE id = $1`
		default:
			logger.Warn("Unknown architecture", zap.String("arch", arch), zap.String("catalogImageID", catalogImageID))
			continue
		}

		_, err = conn.Exec(ctx, updateQuery, catalogImageID, standardScanResult, alternateScanResult, now)
		if err != nil {
			logger.Warn("failed to update scan results",
				zap.String("catalogImageID", catalogImageID),
				zap.String("arch", arch),
				zap.Error(err))
			continue
		}

		logger.Info("Updated catalog scan results",
			zap.String("catalogImageID", catalogImageID),
			zap.String("arch", arch),
			zap.Int("totalCVEs", parsedResults.Counts.TotalCount))
	}

	// Update next_scan_at for next scanning cycle with randomness to distribute load
	nextScanAt := time.Now().Add(scan.GetRandomizedScanInterval()).UTC()
	_, err = conn.Exec(ctx, `UPDATE image_catalog SET next_scan_at = $1 WHERE id = $2`, nextScanAt, catalogImageID)
	if err != nil {
		logger.Warn("Failed to update next_scan_at after successful scan",
			zap.String("catalogImageID", catalogImageID),
			zap.Error(err))
		// Don't return error - scan was successful, just scheduling failed
	} else {
		logger.Debug("Updated next_scan_at for next cycle",
			zap.String("catalogImageID", catalogImageID),
			zap.Time("nextScanAt", nextScanAt))
	}

	return nil
}
