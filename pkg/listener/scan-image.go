package listener

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/image"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/notification"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/registry"
	"go.uber.org/zap"
)

type ScanImagePayload struct {
	ImageID            string `json:"imageId"`
	IncludeSecureBuild bool   `json:"includeSecurebuild"`
	IncludeCanonical   bool   `json:"includeCanonical"`
	ImageTag           string `json:"imageTag,omitempty"` // Optional: filter to specific tag
}

func handleScanImage(ctx context.Context, payload string) error {
	fmt.Println("payload", payload)
	var scanImagePayload ScanImagePayload
	if err := json.Unmarshal([]byte(payload), &scanImagePayload); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}

	logger.Info("scanning image",
		zap.String("image_id", scanImagePayload.ImageID),
		zap.Bool("include_securebuild", scanImagePayload.IncludeSecureBuild),
		zap.Bool("include_canonical", scanImagePayload.IncludeCanonical))

	img, err := image.GetImage(ctx, scanImagePayload.ImageID)
	if err != nil {
		return fmt.Errorf("failed to get image: %w", err)
	}

	for _, apko := range img.APKOs {
		for _, tag := range apko.Tags {
			if scanImagePayload.ImageTag != "" && scanImagePayload.ImageTag != tag {
				continue
			}

			packages, err := image.ListPackagesForAPKO(ctx, apko.LatestVersion.APKOYAML)
			if err != nil {
				return fmt.Errorf("failed to list packages for apko: %w", err)
			}

			actualTag, err := executeTemplate(tag, packages)
			if err != nil {
				return fmt.Errorf("failed to execute template: %w", err)
			}

			imageCatalogID, err := image.GetImageCatalogID(ctx, img.Name, actualTag)
			if err != nil {
				return fmt.Errorf("failed to get image catalog id: %w", err)
			}

			if imageCatalogID == "" {
				continue
			}

			if scanImagePayload.IncludeSecureBuild {
				results, err := image.ScanImage(ctx, registry.ImageRefWithTag(param.GetParam(ctx).RegistryImagePrefix, img.Name, actualTag))
				if err != nil {
					return fmt.Errorf("failed to scan image: %w", err)
				}

				// Use STANDARD scan results (with SecureOS provider) for WWW display
				scanResultX86Raw := results.GrypeScanX86
				scanResultAarch64Raw := results.GrypeScanAarch64

				scanResultX86, err := image.ParseScanResult(scanResultX86Raw)
				if err != nil {
					return fmt.Errorf("failed to parse scan result: %w", err)
				}
				scanResultAarch64, err := image.ParseScanResult(scanResultAarch64Raw)
				if err != nil {
					return fmt.Errorf("failed to parse scan result: %w", err)
				}

				ociPrefix := registry.NormalizePrefix(param.GetParam(ctx).OCIImagePrefix)
				if ociPrefix == "" {
					ociPrefix = registry.NormalizePrefix(param.GetParam(ctx).RegistryImagePrefix)
				}
				fullImageName := registry.ImageRef(ociPrefix, img.Name)
				if err := image.WriteScanResult(ctx, fullImageName, actualTag, "x86_64", *scanResultX86, scanResultX86Raw); err != nil {
					return fmt.Errorf("failed to write scan result: %w", err)
				}

				if err := image.WriteScanResult(ctx, fullImageName, actualTag, "aarch64", *scanResultAarch64, scanResultAarch64Raw); err != nil {
					return fmt.Errorf("failed to write scan result: %w", err)
				}

				// Update image_catalog table with scan results (for WWW security page)
				standardResults := map[string]string{
					"x86_64":  scanResultX86Raw,
					"aarch64": scanResultAarch64Raw,
				}
				if err := updateCatalogScanResults(ctx, imageCatalogID, standardResults); err != nil {
					logger.Warn("failed to update catalog scan results",
						zap.String("catalogImageID", imageCatalogID),
						zap.Error(err))
					// Don't fail the scan - catalog update is not critical
				}

				// Populate cve_package_fix table (vulnerability feed data)
				// Use CUSTOM scan results (without SecureOS provider) to avoid circular dependency
				if apko.ID != "" && results.GrypeScanCustomX86 != "" && results.SyftSBOMX86 != "" {
					if err := saveVulnerabilityFeedData(ctx, apko.ID, results.GrypeScanCustomX86, results.SyftSBOMX86); err != nil {
						// Log error but don't fail the scan
						logger.Errorf("failed to save vulnerability feed data (apkoID: %s): %v", apko.ID, err)
					}
				}

				// Check for CVEs and queue notifications if found
				hasCVEsX86, err := image.HasCVEs(scanResultX86Raw)
				if err != nil {
					logger.Warn("failed to check for CVEs in x86 scan result",
						zap.String("image", img.Name),
						zap.String("tag", actualTag),
						zap.Error(err))
				}

				hasCVEsAarch64, err := image.HasCVEs(scanResultAarch64Raw)
				if err != nil {
					logger.Warn("failed to check for CVEs in aarch64 scan result",
						zap.String("image", img.Name),
						zap.String("tag", actualTag),
						zap.Error(err))
				}

				// Queue CVE notification if CVEs found in either architecture
				if hasCVEsX86 || hasCVEsAarch64 {
					// Get the index digest for the image
					indexDigest := ""
					if imageCatalogID != "" {
						catalogItem, err := image.GetImageCatalogItem(ctx, imageCatalogID)
						if err == nil && catalogItem.IndexDigest != "" {
							indexDigest = catalogItem.IndexDigest
						}
					}

					if err := notification.QueueNotificationEvent(ctx, img.Name, actualTag,
						indexDigest, notification.EventCVEFound, nil); err != nil {
						logger.Warn("failed to queue CVE found notification",
							zap.String("image", img.Name),
							zap.String("tag", actualTag),
							zap.Error(err))
					} else {
						logger.Debug("queued CVE found notification",
							zap.String("image", img.Name),
							zap.String("tag", actualTag))
					}
				}
			}

			if scanImagePayload.IncludeCanonical {
				results, err := image.ScanImage(ctx, fmt.Sprintf("%s:%s", img.AlternateImage, actualTag))
				if err != nil {
					return fmt.Errorf("failed to scan image: %w", err)
				}

				scanResultX86Raw := results.GrypeScanX86
				scanResultAarch64Raw := results.GrypeScanAarch64

				scanResultX86, err := image.ParseScanResult(scanResultX86Raw)
				if err != nil {
					return fmt.Errorf("failed to parse scan result: %w", err)
				}
				scanResultAarch64, err := image.ParseScanResult(scanResultAarch64Raw)
				if err != nil {
					return fmt.Errorf("failed to parse scan result: %w", err)
				}

				if err := image.WriteScanResult(ctx, img.AlternateImage, actualTag, "x86_64", *scanResultX86, scanResultX86Raw); err != nil {
					return fmt.Errorf("failed to write scan result: %w", err)
				}

				if err := image.WriteScanResult(ctx, img.AlternateImage, actualTag, "aarch64", *scanResultAarch64, scanResultAarch64Raw); err != nil {
					return fmt.Errorf("failed to write scan result: %w", err)
				}
			}
		}
	}

	// scan them and write the results

	return nil
}
