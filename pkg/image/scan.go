package image

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/anchore"
	"github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/registry"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
)

// ImageScanResults contains scan results and SBOMs for both architectures
type ImageScanResults struct {
	// Standard database scans (for WWW display)
	// Includes NVD + GitHub + SecureOS provider (useCustomDB=false)
	// Shows vulnerabilities with SecureBuild fixes applied
	GrypeScanX86     string
	GrypeScanAarch64 string

	// Custom database scans (for SecDB feed generation)
	// Includes NVD + GitHub only, NO SecureOS (useCustomDB=true)
	// Pure upstream vulnerability data to avoid circular dependency
	GrypeScanCustomX86     string
	GrypeScanCustomAarch64 string

	// Syft SBOMs
	SyftSBOMX86     string
	SyftSBOMAarch64 string
}

// ScanImage scans an image for vulnerabilities and generates SBOMs.
// Performs both standard database (with SecureOS) and custom database (without SecureOS) scans.
func ScanImage(ctx context.Context, registryURL string) (*ImageScanResults, error) {
	logger.Info("starting image scanning", zap.String("registryURL", registryURL))

	results := &ImageScanResults{}

	// Create a temporary directory for SBOM files
	tmpDir, err := os.MkdirTemp("", "sbom-")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp directory for SBOMs: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Generate and scan SBOMs for each architecture
	aarch64StandardScan, aarch64CustomScan, aarch64SBOM, err := scanImageForArch(ctx, registryURL, "aarch64", tmpDir)
	if err != nil {
		return nil, fmt.Errorf("failed to scan image %s for aarch64: %w", registryURL, err)
	}
	results.GrypeScanAarch64 = aarch64StandardScan
	results.GrypeScanCustomAarch64 = aarch64CustomScan
	results.SyftSBOMAarch64 = aarch64SBOM

	x86StandardScan, x86CustomScan, x86SBOM, err := scanImageForArch(ctx, registryURL, "x86_64", tmpDir)
	if err != nil {
		return nil, fmt.Errorf("failed to scan image %s for x86_64: %w", registryURL, err)
	}
	results.GrypeScanX86 = x86StandardScan
	results.GrypeScanCustomX86 = x86CustomScan
	results.SyftSBOMX86 = x86SBOM

	return results, nil
}

// GenerateSBOM generates an SBOM for the specified image and architecture
func GenerateSBOM(ctx context.Context, registryURL string, arch string) (string, error) {
	platform := ""
	if arch == "aarch64" {
		platform = "linux/arm64"
	} else if arch == "x86_64" {
		platform = "linux/amd64"
	}

	// Add a timeout context for SBOM generation (2 minutes)
	sbomCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	// Set up registry credentials if needed
	var username, password string
	if registry.PrefixMatches(registryURL, param.GetParam(ctx).RegistryImagePrefix) {
		username = param.GetParam(ctx).RegistryUsername
		password = param.GetParam(ctx).RegistryPassword
	}

	startTime := time.Now()
	sbomJSON, err := anchore.GenerateSBOM(sbomCtx, registryURL, platform, username, password)
	duration := time.Since(startTime)

	if err != nil {
		logger.Errorf("SBOM generation failed for %s %s after %v: %v", registryURL, arch, duration, err)

		// Check if it's a timeout
		if sbomCtx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("SBOM generation timed out after 2 minutes for %s %s", registryURL, arch)
		}
		return "", fmt.Errorf("SBOM generation failed for %s %s: %w", registryURL, arch, err)
	}

	logger.Debug("successfully generated SBOM",
		zap.String("imageURL", registryURL),
		zap.String("arch", arch),
		zap.String("duration", duration.String()))

	return sbomJSON, nil
}

func scanImageForArch(ctx context.Context, registryURL string, arch string, workDir string) (string, string, string, error) {
	// Generate SBOM using Syft
	sbomJSON, err := GenerateSBOM(ctx, registryURL, arch)
	if err != nil {
		return "", "", "", fmt.Errorf("failed to generate SBOM: %w", err)
	}

	// Run both scans in parallel for better performance
	var standardScanResult, customScanResult string
	var standardErr, customErr error
	var wg sync.WaitGroup

	wg.Add(2)

	// Scan 1: Standard database (includes SecureOS provider) for WWW display
	go func() {
		defer wg.Done()
		scanner, err := anchore.NewGrypeScanner(ctx, false)
		if err != nil {
			standardErr = fmt.Errorf("failed to create standard Grype scanner: %w", err)
			return
		}
		defer scanner.Close()

		startTime := time.Now()
		standardScanResult, standardErr = scanner.ScanSBOMForCVEs(ctx, sbomJSON)
		duration := time.Since(startTime)

		if standardErr == nil {
			logger.Debug("grype standard scan completed",
				zap.String("imageURL", registryURL),
				zap.String("arch", arch),
				zap.String("duration", duration.String()))
		}
	}()

	// Scan 2: Custom database (NO SecureOS provider) for SecDB feed
	go func() {
		defer wg.Done()
		scanner, err := anchore.NewGrypeScanner(ctx, true)
		if err != nil {
			customErr = fmt.Errorf("failed to create custom Grype scanner: %w", err)
			return
		}
		defer scanner.Close()

		startTime := time.Now()
		customScanResult, customErr = scanner.ScanSBOMForCVEs(ctx, sbomJSON)
		duration := time.Since(startTime)

		if customErr == nil {
			logger.Debug("grype custom scan completed",
				zap.String("imageURL", registryURL),
				zap.String("arch", arch),
				zap.String("duration", duration.String()))
		}
	}()

	wg.Wait()

	if standardErr != nil {
		return "", "", "", fmt.Errorf("standard scan failed for arch %s: %w", arch, standardErr)
	}
	if customErr != nil {
		return "", "", "", fmt.Errorf("custom scan failed for arch %s: %w", arch, customErr)
	}

	return standardScanResult, customScanResult, sbomJSON, nil
}

func ParseScanResult(scanResult string) (*types.ImageScanResult, error) {
	var result struct {
		Matches []grypeMatchResult `json:"matches"`
	}

	if err := json.Unmarshal([]byte(scanResult), &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal scan result: %w", err)
	}

	counts := types.ImageScanResult{}
	for _, match := range result.Matches {
		switch strings.ToLower(match.Vulnerability.Severity) {
		case "critical":
			counts.CriticalCount++
		case "high":
			counts.HighCount++
		case "medium":
			counts.MediumCount++
		case "low":
			counts.LowCount++
		}
		// NOTE: We omit "negligible" and "unknown" vulnerabilities

		// Count fixable CVEs
		if match.Vulnerability.Fix.State == "fixed" && len(match.Vulnerability.Fix.Versions) > 0 {
			counts.FixableCount++
		}
	}

	counts.TotalCount = counts.CriticalCount + counts.HighCount + counts.MediumCount + counts.LowCount

	return &counts, nil
}

func ParseScanResultDetails(scanResult string) (*types.ImageScanResultDetails, error) {
	var result struct {
		Matches    []grypeMatchResult `json:"matches"`
		Descriptor struct {
			Name    string `json:"name"`
			Version string `json:"version"`
		} `json:"descriptor"`
	}

	if err := json.Unmarshal([]byte(scanResult), &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal scan result: %w", err)
	}

	details := types.ImageScanResultDetails{
		Counts:      types.ImageScanResult{},
		FixedCounts: types.ImageScanResult{},
		CreatedAt:   time.Now().UTC(),
		Critical:    make(map[string]string),
		High:        make(map[string]string),
		Medium:      make(map[string]string),
		Low:         make(map[string]string),
		Descriptor: types.ScanDescriptor{
			Name:    result.Descriptor.Name,
			Version: result.Descriptor.Version,
		},
	}

	for _, match := range result.Matches {
		vulnerabilityInfo := extractVulnerabilityInfo(match)

		incrementFixed := 0
		if vulnerabilityInfo.FixState == "fixed" {
			incrementFixed = 1
		}

		switch vulnerabilityInfo.Severity {
		case "critical":
			details.Critical[vulnerabilityInfo.CVE] = vulnerabilityInfo.Description
			details.Counts.CriticalCount += 1
			details.FixedCounts.CriticalCount += incrementFixed
		case "high":
			details.High[vulnerabilityInfo.CVE] = vulnerabilityInfo.Description
			details.Counts.HighCount += 1
			details.FixedCounts.HighCount += incrementFixed
		case "medium":
			details.Medium[vulnerabilityInfo.CVE] = vulnerabilityInfo.Description
			details.Counts.MediumCount += 1
			details.FixedCounts.MediumCount += incrementFixed
		case "low":
			details.Low[vulnerabilityInfo.CVE] = vulnerabilityInfo.Description
			details.Counts.LowCount += 1
			details.FixedCounts.LowCount += incrementFixed
		default:
			// NOTE: We omit "negligible" and "unknown" vulnerabilities
			continue
		}

		details.Counts.TotalCount += 1
		details.FixedCounts.TotalCount += incrementFixed
		details.VulnerabilityDetails = append(details.VulnerabilityDetails, vulnerabilityInfo)
	}

	return &details, nil
}

// extractVulnerabilityInfo extracts vulnerability and artifact information from a match object
func extractVulnerabilityInfo(match grypeMatchResult) types.VulnerabilityDetail {
	var epssPercentile float64
	if len(match.Vulnerability.EPSS) > 0 {
		epssPercentile = match.Vulnerability.EPSS[0].Percentile
	}

	description := match.Vulnerability.Description
	if description == "" {
		for _, relatedVulnerability := range match.RelatedVulnerabilities {
			if relatedVulnerability.Description != "" {
				description = relatedVulnerability.Description
				break
			}
		}
	}

	artifactPath := ""
	if len(match.Artifact.Locations) > 0 {
		artifactPath = match.Artifact.Locations[0].Path
	}

	return types.VulnerabilityDetail{
		CVE:             match.Vulnerability.ID,
		Description:     description,
		ArtifactID:      match.Artifact.ID,
		ArtifactPath:    artifactPath,
		ArtifactType:    match.Artifact.Type,
		ArtifactName:    match.Artifact.Name,
		ArtifactVersion: match.Artifact.Version,
		FixState:        match.Vulnerability.Fix.State,
		FixVersions:     match.Vulnerability.Fix.Versions,
		Severity:        strings.ToLower(match.Vulnerability.Severity),
		EpssPercentile:  epssPercentile,
		Risk:            match.Vulnerability.Risk,
	}
}

// HasCVEs checks if the scan result contains any CVE vulnerabilities
func HasCVEs(scanResultRaw string) (bool, error) {
	var result struct {
		Matches []struct {
			Vulnerability struct {
				ID string `json:"id"`
			} `json:"vulnerability"`
		} `json:"matches"`
	}

	if err := json.Unmarshal([]byte(scanResultRaw), &result); err != nil {
		return false, fmt.Errorf("failed to unmarshal scan result: %w", err)
	}

	// Check if any vulnerabilities have CVE IDs
	for _, match := range result.Matches {
		if strings.HasPrefix(match.Vulnerability.ID, "CVE-") {
			return true, nil
		}
	}

	return false, nil
}

// SaveImageSBOMs saves the Syft-generated SBOMs to the image_sbom table
func SaveImageSBOMs(ctx context.Context, apkoID string, sbomX86Raw, sbomAarch64Raw string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Generate a random ID for the SBOM record
	id, err := securerandom.Hex(16)
	if err != nil {
		return fmt.Errorf("failed to generate random ID: %w", err)
	}

	now := time.Now().UTC()

	// Insert or update the SBOM record
	upsertQuery := `
		INSERT INTO image_sbom (id, image_apko_id, syft_sbom_x86, syft_sbom_aarch64, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $5)
		ON CONFLICT (image_apko_id) DO UPDATE SET
			syft_sbom_x86 = EXCLUDED.syft_sbom_x86,
			syft_sbom_aarch64 = EXCLUDED.syft_sbom_aarch64,
			updated_at = EXCLUDED.updated_at
			WHERE image_sbom.syft_sbom_x86 IS DISTINCT FROM EXCLUDED.syft_sbom_x86
			   OR image_sbom.syft_sbom_aarch64 IS DISTINCT FROM EXCLUDED.syft_sbom_aarch64`

	_, err = conn.Exec(ctx, upsertQuery, id, apkoID, sbomX86Raw, sbomAarch64Raw, now)
	if err != nil {
		return fmt.Errorf("failed to upsert SBOM record: %w", err)
	}

	return nil
}

func WriteScanResult(ctx context.Context, imageName string, imageTag string, arch string, scanResult types.ImageScanResult, scanResultRaw string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now().UTC()

	// Insert into image_scan table (historical record)
	id, err := securerandom.Hex(16)
	if err != nil {
		return fmt.Errorf("failed to generate random ID: %w", err)
	}

	query := `insert into image_scan (id, image_name, image_tag, image_arch, result, created_at, vuln_count_critical, vuln_count_high, vuln_count_medium, vuln_count_low, vuln_count_fixable) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`
	_, err = conn.Exec(ctx, query, id, imageName, imageTag, arch, scanResultRaw, now, scanResult.CriticalCount, scanResult.HighCount, scanResult.MediumCount, scanResult.LowCount, scanResult.FixableCount)
	if err != nil {
		return fmt.Errorf("failed to write scan result: %w", err)
	}

	return nil
}

// GetFixedCVEsFromLatestScan calculates the fixed CVE count by comparing the latest scan result
// from image_scan for the alternate image vs the current scan result.
// Returns the fixed CVE count and the alternate image scan result.
func GetFixedCVEsFromLatestScan(ctx context.Context, alternateImageName, imageTag, arch string, currentScanResult string) (int, string, error) {
	if alternateImageName == "" || currentScanResult == "" {
		return 0, "", nil
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Get the latest alternate image scan result from image_scan table
	query := `SELECT result FROM image_scan WHERE image_name = $1 AND image_tag = $2 AND image_arch = $3 ORDER BY created_at DESC LIMIT 1`
	var alternateResultRaw string
	err := conn.QueryRow(ctx, query, alternateImageName, imageTag, arch).Scan(&alternateResultRaw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// No alternate scan available, return 0 with empty result
			return 0, "", nil
		}
		return 0, "", fmt.Errorf("failed to get alternate image scan result: %w", err)
	}

	// Use the existing CountFixedCVEs logic from pkg/image/image.go
	count, err := CountFixedCVEs(ctx, currentScanResult, alternateResultRaw)
	if err != nil {
		return 0, "", err
	}

	return count, alternateResultRaw, nil
}

// grypeMatchResult represents a single vulnerability match from the raw scan results
type grypeMatchResult struct {
	Vulnerability          grypeVulnerabilityDetails   `json:"vulnerability"`
	RelatedVulnerabilities []grypeVulnerabilityDetails `json:"relatedVulnerabilities"`
	Artifact               grypeArtifactDetails        `json:"artifact"`
}

// grypeVulnerabilityDetails contains the vulnerability information from a match
type grypeVulnerabilityDetails struct {
	ID          string             `json:"id"`
	Severity    string             `json:"severity"`
	Description string             `json:"description"`
	EPSS        []grypeEpssDetails `json:"epss"`
	Fix         grypeFixDetails    `json:"fix"`
	Risk        float64            `json:"risk"`
}

// grypeEpssDetails contains EPSS (Exploit Prediction Scoring System) information
type grypeEpssDetails struct {
	Percentile float64 `json:"percentile"`
}

// grypeFixDetails contains information about available fixes
type grypeFixDetails struct {
	Versions []string `json:"versions"`
	State    string   `json:"state"`
}

// grypeArtifactDetails contains information about the affected artifact
type grypeArtifactDetails struct {
	ID        string                  `json:"id"`
	Name      string                  `json:"name"`
	Version   string                  `json:"version"`
	Type      string                  `json:"type"`
	Locations []grypeArtifactLocation `json:"locations"`
}

// grypeArtifactLocation contains information about the location of the affected artifact
type grypeArtifactLocation struct {
	Path string `json:"path"`
}
