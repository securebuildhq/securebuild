package anchore

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strings"

	"github.com/anchore/clio"
	"github.com/anchore/grype/grype"
	"github.com/anchore/grype/grype/db/v6/distribution"
	"github.com/anchore/grype/grype/db/v6/installation"
	"github.com/anchore/grype/grype/distro"
	"github.com/anchore/grype/grype/matcher"
	"github.com/anchore/grype/grype/pkg"
	"github.com/anchore/grype/grype/presenter/models"
	"github.com/anchore/grype/grype/vulnerability"
	"github.com/anchore/stereoscope"
	"github.com/anchore/stereoscope/pkg/image"
	"github.com/anchore/syft/syft"
	"github.com/anchore/syft/syft/format/spdxjson"
	"github.com/anchore/syft/syft/format/syftjson"
	"github.com/anchore/syft/syft/sbom"
	"github.com/anchore/syft/syft/source/stereoscopesource"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
)

// GrypeScanner wraps the Grype library for scanning SBOMs
type GrypeScanner struct {
	vulnProvider vulnerability.Provider
	matcher      *grype.VulnerabilityMatcher
}

// getGrypeVersion returns the version of the grype module from the compiled binary's build info.
// Falls back to a default version if the build info is not available (e.g., during testing).
func getGrypeVersion() string {
	buildInfo, ok := debug.ReadBuildInfo()
	if !ok {
		logger.Warn("unable to read build info, using default grype version")
		return "v0.109.0" // Fallback version
	}

	for _, dep := range buildInfo.Deps {
		if dep.Path == "github.com/anchore/grype" {
			return dep.Version
		}
	}

	logger.Warn("grype module not found in build info, using default version")
	return "v0.109.0" // Fallback version
}

// NewGrypeScanner creates a new scanner with the configured database.
// If useCustomDB is true, it will use the custom vulnerability database configured via GrypeDBRoot.
// If useCustomDB is false, it will use the default grype database (downloaded automatically if needed).
func NewGrypeScanner(ctx context.Context, useCustomDB bool) (*GrypeScanner, error) {
	grypeDBRoot := param.GetParam(ctx).GrypeDBRoot

	// If custom DB is requested, validate that it's properly configured
	if useCustomDB && grypeDBRoot != "" {
		// Convert to absolute path if relative
		absGrypeDBRoot, err := filepath.Abs(grypeDBRoot)
		if err == nil {
			grypeDBRoot = absGrypeDBRoot
		}

		// Check if vunnel config exists
		vunnelConfig := filepath.Join(grypeDBRoot, "vunnel.yaml")
		if _, err := os.Stat(vunnelConfig); err != nil {
			logger.Warn("Vunnel config not found, falling back to default grype database",
				zap.String("config_path", vunnelConfig))
			useCustomDB = false
		} else {
			logger.Info("Using custom vulnerability database", zap.String("grype_db_root", grypeDBRoot))
		}
	} else if useCustomDB && grypeDBRoot == "" {
		logger.Warn("Custom DB requested but GRYPE_DATABASE_ROOT not configured, using default grype database")
		useCustomDB = false
	}

	// Configure database distribution (where to find database)
	// When using default database, allow update to download if missing
	var distConfig distribution.Config
	var installConfig installation.Config

	if useCustomDB {
		// Custom database: don't check for updates, use local database only. There is a separate process using grype-db for updates.
		distConfig = distribution.Config{
			RequireUpdateCheck: false,
		}
		installConfig = installation.Config{
			DBRootDir:          grypeDBRoot + "/cache",
			ValidateAge:        false,
			MaxAllowedBuiltAge: 0, // No age validation
		}
	} else {
		// Default database: use grype's default configuration
		distConfig = distribution.DefaultConfig()
		distConfig.RequireUpdateCheck = true // Check for updates and download if missing

		// Use the same default path as grype CLI: ~/.cache/grype/db
		grypeVersion := getGrypeVersion()
		installConfig = installation.DefaultConfig(clio.Identification{
			Name:    "grype",
			Version: grypeVersion,
		})
		logger.Debug("using default grype cache directory",
			zap.String("db_root", installConfig.DBRootDir),
			zap.String("grype_version", grypeVersion))
	}

	// Load the vulnerability database
	// When using default database, pass 'true' to allow downloading
	vulnProvider, status, err := grype.LoadVulnerabilityDB(distConfig, installConfig, !useCustomDB)
	if err != nil {
		return nil, fmt.Errorf("failed to load vulnerability database: %w", err)
	}

	if status != nil {
		logger.Info("vulnerability database loaded",
			zap.Time("built_at", status.Built),
			zap.Bool("use_custom_db", useCustomDB),
			zap.String("db_schema_version", status.SchemaVersion),
			zap.String("db_location", installConfig.DBRootDir))
	}

	// Create default matchers for all supported ecosystems
	matchers := matcher.NewDefaultMatchers(matcher.Config{})

	// Create the vulnerability matcher
	vulnMatcher := &grype.VulnerabilityMatcher{
		VulnerabilityProvider: vulnProvider,
		Matchers:              matchers,
		NormalizeByCVE:        true, // Group matches by CVE
	}

	return &GrypeScanner{
		vulnProvider: vulnProvider,
		matcher:      vulnMatcher,
	}, nil
}

// ScanSBOMForCVEs scans a Syft SBOM and returns Grype's official JSON format
// This is the preferred method that preserves all Grype data without custom conversions
func (s *GrypeScanner) ScanSBOMForCVEs(ctx context.Context, sbomJSON string) (result string, err error) {
	span, ctx := telemetry.StartSpan(ctx, "anchore.ScanSBOMForCVEs")
	defer func() {
		if err != nil {
			span.SetTag("error", err)
		}
		span.Finish()
	}()

	// Parse the SBOM
	sbomObj, err := s.ParseSBOM(sbomJSON)
	if err != nil {
		return "", fmt.Errorf("failed to parse SBOM: %w", err)
	}

	var grypeDistro *distro.Distro
	if sbomObj.Artifacts.LinuxDistribution != nil {
		logger.Debug("found Linux distribution in SBOM",
			zap.String("name", sbomObj.Artifacts.LinuxDistribution.Name),
			zap.String("version", sbomObj.Artifacts.LinuxDistribution.Version),
			zap.String("id", sbomObj.Artifacts.LinuxDistribution.ID),
			zap.String("idLike", fmt.Sprintf("%v", sbomObj.Artifacts.LinuxDistribution.IDLike)),
			zap.String("prettyName", sbomObj.Artifacts.LinuxDistribution.PrettyName))

		grypeDistro, err = distro.NewFromRelease(*sbomObj.Artifacts.LinuxDistribution, distro.DefaultFixChannels())
		if err != nil {
			// Don't fail the scan if we can't determine the distro type
			// This allows scanning of language-level packages (npm, pip, go, etc.)
			// even if OS-level package vulnerabilities won't be matched
			logger.Warn("unable to determine Linux distribution type, continuing without distro context",
				zap.String("distro_id", sbomObj.Artifacts.LinuxDistribution.ID),
				zap.String("distro_name", sbomObj.Artifacts.LinuxDistribution.Name),
				zap.Error(err))
			grypeDistro = nil
		} else {
			logger.Debug("created grype distro",
				zap.String("type", grypeDistro.Type.String()),
				zap.String("name", grypeDistro.Name()),
				zap.String("version", grypeDistro.Version))
		}
	} else {
		logger.Debug("no Linux distribution found in SBOM")
	}

	// This will ensure the correct Vunnel provider is used for CVE matching
	packages := pkg.FromCollection(sbomObj.Artifacts.Packages, pkg.SynthesisConfig{
		Distro: pkg.DistroConfig{
			Override: grypeDistro,
		},
	})

	// Create package context with distro information
	pkgContext := pkg.Context{
		Source: &sbomObj.Source,
		Distro: grypeDistro,
	}

	// Find vulnerability matches
	remainingMatches, _, err := s.matcher.FindMatches(packages, pkgContext)
	if err != nil {
		return "", fmt.Errorf("failed to match vulnerabilities: %w", err)
	}

	// Count fixable matches for logging
	fixableCount := 0
	for m := range remainingMatches.Enumerate() {
		if m.Vulnerability.Fix.State == "fixed" && len(m.Vulnerability.Fix.Versions) > 0 {
			fixableCount++
		}
	}

	logger.Info("SBOM scan completed",
		zap.Int("total_matches", remainingMatches.Count()),
		zap.Int("fixable_matches", fixableCount))

	// Convert packages to sorted slice
	packageSlice := make([]pkg.Package, 0, len(packages))
	for _, p := range packages {
		packageSlice = append(packageSlice, p)
	}
	// Sort packages by name for consistent output
	sort.Slice(packageSlice, func(i, j int) bool {
		return packageSlice[i].Name < packageSlice[j].Name
	})

	// Create Grype's official JSON document using the presenter
	doc, err := models.NewDocument(
		clio.Identification{
			Name:    "grype",
			Version: getGrypeVersion(),
		},
		packageSlice,
		pkgContext,
		*remainingMatches, // Dereference pointer
		nil,               // No ignored matches
		s.vulnProvider,
		nil,               // No app config
		nil,               // No DB info
		models.SortByRisk, // Use official sort strategy
		false,             // No timestamp
		nil,               // No distro alert data
	)
	if err != nil {
		return "", fmt.Errorf("failed to create Grype document: %w", err)
	}

	// Marshal to JSON
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(&doc); err != nil {
		return "", fmt.Errorf("failed to marshal Grype document: %w", err)
	}

	return buf.String(), nil
}

// ParseSBOM parses an SBOM string (either Syft JSON or SPDX JSON) into an SBOM object
func (s *GrypeScanner) ParseSBOM(sbomJSON string) (*sbom.SBOM, error) {
	// Auto-detect format by examining the JSON structure
	format, err := detectSBOMFormat(sbomJSON)
	if err != nil {
		return nil, fmt.Errorf("failed to detect SBOM format: %w", err)
	}

	logger.Debug("detected SBOM format", zap.String("format", format))

	reader := strings.NewReader(sbomJSON)

	var decoder sbom.FormatDecoder
	switch format {
	case "spdx-json":
		decoder = spdxjson.NewFormatDecoder()
	case "syft-json":
		decoder = syftjson.NewFormatDecoder()
	default:
		return nil, fmt.Errorf("unsupported SBOM format: %s", format)
	}

	sbomObj, _, _, err := decoder.Decode(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to decode SBOM as %s: %w", format, err)
	}

	return sbomObj, nil
}

// detectSBOMFormat detects whether an SBOM is in SPDX or Syft JSON format
func detectSBOMFormat(sbomJSON string) (string, error) {
	var generic map[string]interface{}
	if err := json.Unmarshal([]byte(sbomJSON), &generic); err != nil {
		return "", fmt.Errorf("failed to unmarshal SBOM: %w", err)
	}

	// Check for SPDX format (has spdxVersion field)
	if _, hasSPDX := generic["spdxVersion"]; hasSPDX {
		return "spdx-json", nil
	}

	// Check for Syft JSON format (has schema.url field with syft)
	if schema, hasSchema := generic["schema"].(map[string]interface{}); hasSchema {
		if url, ok := schema["url"].(string); ok && strings.Contains(url, "syft") {
			return "syft-json", nil
		}
	}

	return "", fmt.Errorf("failed to detect SBOM format")
}

// Close closes the scanner and releases resources
func (s *GrypeScanner) Close() error {
	if s.vulnProvider != nil {
		return s.vulnProvider.Close()
	}
	return nil
}

// GenerateSBOM generates an SBOM for a container image using Syft library
func GenerateSBOM(ctx context.Context, imageRef, platform, username, password string) (string, error) {
	logger.Debug("generating SBOM with Syft library",
		zap.String("imageRef", imageRef),
		zap.String("platform", platform))

	// Configure stereoscope options for registry access
	var stereoscopeOpts []stereoscope.Option

	// Configure platform if specified (pass as string)
	if platform != "" {
		stereoscopeOpts = append(stereoscopeOpts, stereoscope.WithPlatform(platform))
	}

	// Configure registry credentials if provided
	if username != "" && password != "" {
		regOpts := image.RegistryOptions{
			Credentials: []image.RegistryCredentials{
				{
					Authority: "", // Empty authority means apply to all registries
					Username:  username,
					Password:  password,
				},
			},
		}
		stereoscopeOpts = append(stereoscopeOpts, stereoscope.WithRegistryOptions(regOpts))
	}

	// Use stereoscope directly to get the image from OCI registry
	// This matches the behavior of "syft registry:..." CLI command
	img, err := stereoscope.GetImageFromSource(ctx, imageRef, image.OciRegistrySource, stereoscopeOpts...)
	if err != nil {
		return "", fmt.Errorf("failed to get image from registry: %w", err)
	}
	defer img.Cleanup()

	// Wrap the stereoscope image in a Syft source
	src := stereoscopesource.New(img, stereoscopesource.ImageConfig{
		Reference: imageRef,
	})

	// Create SBOM from the source
	sbomConfig := syft.DefaultCreateSBOMConfig()
	sbomResult, err := syft.CreateSBOM(ctx, src, sbomConfig)
	if err != nil {
		return "", fmt.Errorf("failed to create SBOM: %w", err)
	}

	// Encode SBOM to Syft JSON format
	encoder := syftjson.NewFormatEncoder()
	var buf strings.Builder
	if err := encoder.Encode(&buf, *sbomResult); err != nil {
		return "", fmt.Errorf("failed to encode SBOM to JSON: %w", err)
	}

	sbomJSON := buf.String()
	logger.Debug("successfully generated SBOM with Syft library",
		zap.String("imageRef", imageRef),
		zap.Int("sbom_size", len(sbomJSON)))

	return sbomJSON, nil
}
