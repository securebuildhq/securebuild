package image

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	apkopackage "chainguard.dev/apko/pkg/apk/apk"
	apkotypes "chainguard.dev/apko/pkg/build/types"
	"github.com/blang/semver"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

var (
	ErrImageNotFound = errors.New("image not found")
)

func AlternateImageExists(ctx context.Context, registryURL string) (bool, error) {
	// registry url will be someting like "postgres:latest" anmd we need to confirm that we can access it
	ref, err := name.ParseReference(registryURL)
	if err != nil {
		return false, fmt.Errorf("invalid image reference: %w", err)
	}

	_, err = remote.Head(ref, remote.WithContext(ctx))
	if err != nil {
		if strings.Contains(err.Error(), "404 Not Found") {
			return false, nil
		}
		if strings.Contains(err.Error(), "401 Unauthorized") {
			return false, nil
		}
		if strings.Contains(err.Error(), "requested access to the resource is denied") {
			return false, nil
		}
		return false, fmt.Errorf("image not pullable: %w", err)
	}

	return true, nil
}

func ListPackagesForAPKO(ctx context.Context, apkoYAML string) ([]types.APKPackageVersion, error) {
	// Parse the APKO YAML to extract package pinned versions
	var imageConfig apkotypes.ImageConfiguration
	if err := yaml.Unmarshal([]byte(apkoYAML), &imageConfig); err != nil {
		return nil, fmt.Errorf("failed to parse APKO YAML: %w", err)
	}

	// Build a map of package name to pinned version from the APKO YAML
	pinnedVersions := make(map[string]string)
	for _, pkg := range imageConfig.Contents.Packages {
		// Parse the package name and version pin using apko's parser
		parsed := apkopackage.ResolvePackageNameVersionPin(pkg)
		if parsed.Version != "" {
			pinnedVersions[parsed.Name] = parsed.Version
		}
	}

	tmpDir, err := os.MkdirTemp("", "securebuild-image-build")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmpDir)

	// Create a temporary cache directory for apko
	cacheDir, err := os.MkdirTemp("", "securebuild-apko-cache")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(cacheDir)

	apkoYAMLPath := filepath.Join(tmpDir, "apko.yaml")
	if err := os.WriteFile(apkoYAMLPath, []byte(apkoYAML), 0644); err != nil {
		return nil, err
	}

	cmd := exec.Command("apko", "--log-level", "debug", "--arch", "x86_64,aarch64", "--cache-dir", cacheDir, "show-packages", apkoYAMLPath)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	if err != nil {
		logger.Error(fmt.Errorf("apko show-packages failed: %w, stderr: %s", err, stderr.String()))
		return nil, fmt.Errorf("apko show-packages failed: %w, stderr: %s", err, stderr.String())
	}

	output := stdout.Bytes()

	packages := []types.APKPackageVersion{}
	// read output line by line
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.Split(line, " ")

		if len(parts) != 2 {
			continue
		}

		packageName := parts[0]
		packageVersion := parts[1]

		versionWithoutRelease, release, err := parseVersionWithoutRelease(packageVersion)
		if err != nil {
			return nil, err
		}

		pkg := types.APKPackageVersion{
			Name:               packageName,
			VersionWithRelease: packageVersion,
			Version:            versionWithoutRelease,
			Release:            release,
		}

		// Set the pinned version if one was found in the APKO YAML
		if pinnedVer, ok := pinnedVersions[packageName]; ok {
			pkg.PinnedVersion = pinnedVer
		}

		// try to semver parse the version without release
		sv, err := semver.ParseTolerant(versionWithoutRelease)
		if err == nil {
			pkg.Major = strconv.FormatUint(sv.Major, 10)
			pkg.Minor = strconv.FormatUint(sv.Minor, 10)
			pkg.Patch = strconv.FormatUint(sv.Patch, 10)
		}

		packages = append(packages, pkg)

	}

	return packages, nil
}

func parseVersionWithoutRelease(version string) (string, string, error) {
	parts := strings.Split(version, "-")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("invalid version: %s", version)
	}

	// the release is the last part
	release := parts[len(parts)-1]

	// the version is the rest
	versionWithoutRelease := strings.Join(parts[:len(parts)-1], "-")

	return versionWithoutRelease, release, nil
}

func GetImage(ctx context.Context, id string) (*types.Image, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, name, created_at, updated_at, alternate_image, readme
		FROM image
		WHERE id = $1
	`

	var image types.Image
	var alternateImage string
	var readme sql.NullString
	if err := conn.QueryRow(ctx, query, id).Scan(&image.ID, &image.Name, &image.CreatedAt, &image.UpdatedAt, &alternateImage, &readme); err != nil {
		return nil, err
	}

	apkos, err := listImageAPKOs(ctx, id)
	if err != nil {
		return nil, err
	}
	image.APKOs = apkos

	image.AlternateImage = alternateImage
	image.Readme = readme.String

	return &image, nil
}

// IsImagePublic checks if an image is marked as public by its name
func IsImagePublic(ctx context.Context, imageName string) (bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT is_public
		FROM image
		WHERE name = $1
	`

	logger.Debug("Checking if image is public", zap.String("imageName", imageName))

	var isPublic bool
	err := conn.QueryRow(ctx, query, imageName).Scan(&isPublic)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			logger.Debug("Image not found in database", zap.String("imageName", imageName))
			return false, nil // Image not found, consider it not public
		}
		logger.Error(fmt.Errorf("error checking image public status for %s: %w", imageName, err))
		return false, err
	}

	logger.Debug("Image public status", zap.String("imageName", imageName), zap.Bool("isPublic", isPublic))
	return isPublic, nil
}

// ListImageAPKOs returns all APKO configurations for a given image
func ListImageAPKOs(ctx context.Context, imageID string) ([]*types.ImageAPKO, error) {
	return listImageAPKOs(ctx, imageID)
}

func listImageAPKOs(ctx context.Context, imageID string) ([]*types.ImageAPKO, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, name, tags, created_at, updated_at, readme
		FROM image_apko
		WHERE image_id = $1
	`
	rows, err := conn.Query(ctx, query, imageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	apkos := []*types.ImageAPKO{}
	for rows.Next() {
		var apko types.ImageAPKO
		var readme sql.NullString
		if err := rows.Scan(&apko.ID, &apko.Name, &apko.Tags, &apko.CreatedAt, &apko.UpdatedAt, &readme); err != nil {
			return nil, err
		}
		apko.Readme = readme.String
		apkos = append(apkos, &apko)
	}
	rows.Close()

	for _, apko := range apkos {
		latestVersion, err := GetLatestImageAPKOVersion(ctx, apko.ID)
		if err != nil {
			return nil, err
		}
		apko.LatestVersion = latestVersion
	}

	return apkos, nil
}

func GetLatestImageAPKOVersion(ctx context.Context, apkoID string) (types.ImageAPKOVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, apko_yaml, created_at, updated_at
		FROM image_apko_version
		WHERE image_apko_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`
	row := conn.QueryRow(ctx, query, apkoID)

	var version types.ImageAPKOVersion
	if err := row.Scan(&version.ID, &version.APKOYAML, &version.CreatedAt, &version.UpdatedAt); err != nil {
		return types.ImageAPKOVersion{}, err
	}

	return version, nil
}

// GetImageApkoVersion gets an image APKO version by its ID
func GetImageApkoVersion(ctx context.Context, imageApkoVersionID string) (types.ImageAPKOVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, image_apko_id, apko_yaml, created_at, updated_at
		FROM image_apko_version
		WHERE id = $1
	`
	row := conn.QueryRow(ctx, query, imageApkoVersionID)

	var version types.ImageAPKOVersion
	if err := row.Scan(&version.ID, &version.ImageApkoID, &version.APKOYAML, &version.CreatedAt, &version.UpdatedAt); err != nil {
		return types.ImageAPKOVersion{}, err
	}

	return version, nil
}

func CountFixedCVEs(ctx context.Context, ours string, canonical string) (int, error) {
	if canonical == "" || ours == "" {
		return 0, nil
	}

	type GrypeVulnerability struct {
		ID string `json:"id"`
	}

	type GrypeArtifact struct {
		Name string `json:"name"`
	}

	type GrypeMatch struct {
		Vulnerability GrypeVulnerability `json:"vulnerability"`
		Artifact      GrypeArtifact      `json:"artifact"`
	}

	type GrypeOutput struct {
		Matches []GrypeMatch `json:"matches"`
	}

	var ourOutput GrypeOutput
	if err := json.Unmarshal([]byte(ours), &ourOutput); err != nil {
		return 0, fmt.Errorf("failed to unmarshal our scan result: %w", err)
	}

	var canonicalOutput GrypeOutput
	if err := json.Unmarshal([]byte(canonical), &canonicalOutput); err != nil {
		return 0, fmt.Errorf("failed to unmarshal canonical scan result: %w", err)
	}

	ourVulns := make(map[string]struct{})
	for _, match := range ourOutput.Matches {
		key := fmt.Sprintf("%s|%s", match.Vulnerability.ID, match.Artifact.Name)
		ourVulns[key] = struct{}{}
	}

	fixedCount := 0
	for _, match := range canonicalOutput.Matches {
		key := fmt.Sprintf("%s|%s", match.Vulnerability.ID, match.Artifact.Name)
		if _, exists := ourVulns[key]; !exists {
			fixedCount++
		}
	}

	return fixedCount, nil
}

// GetImageIDByDigest returns the image ID for a given image digest.
// This looks up the digest in the image_catalog table and returns the corresponding image_id.
func GetImageIDByDigest(ctx context.Context, digest string) (string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Look up the digest in both digest_x86 and digest_aarch64 columns
	query := `SELECT image_id FROM image_catalog WHERE digest_x86 = $1 OR digest_aarch64 = $1 OR index_digest = $1 ORDER BY is_published DESC LIMIT 1`
	var imageID string
	if err := conn.QueryRow(ctx, query, digest).Scan(&imageID); err != nil {
		return "", err
	}
	return imageID, nil
}

// GetAPKO fetches a single ImageAPKO by ID and returns the APKO object plus the image ID.
func GetAPKO(ctx context.Context, id string) (*types.ImageAPKO, string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT ia.id, ia.name, ia.tags, ia.created_at, ia.updated_at, ia.readme, ia.image_id
		FROM image_apko ia
		WHERE ia.id = $1
	`

	var apko types.ImageAPKO
	var apkoReadme sql.NullString
	var imageID string
	if err := conn.QueryRow(ctx, query, id).Scan(&apko.ID, &apko.Name, &apko.Tags, &apko.CreatedAt, &apko.UpdatedAt, &apkoReadme, &imageID); err != nil {
		return nil, "", err
	}
	apko.Readme = apkoReadme.String

	latestVersion, err := GetLatestImageAPKOVersion(ctx, apko.ID)
	if err != nil {
		return nil, "", err
	}
	apko.LatestVersion = latestVersion

	return &apko, imageID, nil
}

// UpdateAPKOLastBuilt updates the last_built_at timestamp for an APKO
func UpdateAPKOLastBuilt(ctx context.Context, apkoID string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := "UPDATE image_apko SET last_built_at = now() WHERE id = $1"
	_, err := conn.Exec(ctx, query, apkoID)
	return err
}

// GetImageAPKOVersionsByCustomBuildRequestID gets all image_apko_version records for a custom build request
func GetImageAPKOVersionsByCustomBuildRequestID(ctx context.Context, customBuildRequestID string) ([]types.ImageAPKOVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, image_apko_id, apko_yaml, created_at, updated_at
		FROM image_apko_version
		WHERE custom_build_request_id = $1
		ORDER BY created_at ASC
	`

	rows, err := conn.Query(ctx, query, customBuildRequestID)
	if err != nil {
		return nil, fmt.Errorf("failed to query image apko versions: %w", err)
	}
	defer rows.Close()

	var apkoVersions []types.ImageAPKOVersion
	for rows.Next() {
		var version types.ImageAPKOVersion
		if err := rows.Scan(&version.ID, &version.ImageApkoID, &version.APKOYAML, &version.CreatedAt, &version.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan image apko version: %w", err)
		}
		apkoVersions = append(apkoVersions, version)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating image apko versions: %w", err)
	}

	return apkoVersions, nil
}

// IsPackageCoreForAPKO checks if a package is a core package for a given APKO
// A package is considered "core" if it appears in the APKO YAML with a pin that matches the oldVersion,
// and one of the APKO's tags matches the oldVersion (with or without "v" prefix)
func IsPackageCoreForAPKO(ctx context.Context, apkoYAML string, apkoTags []string, familyName string, packageName string, oldVersion string, oldPackageVersionID string) (bool, error) {
	logger.Debug("IsPackageCoreForAPKO",
		zap.String("apkoYAML", apkoYAML),
		zap.Strings("apkoTags", apkoTags),
		zap.String("familyName", familyName),
		zap.String("packageName", packageName),
		zap.String("oldVersion", oldVersion),
		zap.String("oldPackageVersionID", oldPackageVersionID))

	// Get all possible names from package_version_provides
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	rows, err := conn.Query(ctx, `
		SELECT package_name, provides_name
		FROM package_version_provides
		WHERE package_version_id = $1
	`, oldPackageVersionID)
	if err != nil {
		return false, fmt.Errorf("failed to query provides: %w", err)
	}
	defer rows.Close()

	possibleNames := make(map[string]struct{})
	// Always include the family name (base name like "registry") and versioned package name (like "registry-2.8")
	// APKOs typically reference packages by their family/provides name
	possibleNames[familyName] = struct{}{}
	possibleNames[packageName] = struct{}{}

	for rows.Next() {
		var pkgName, providesName string
		if err := rows.Scan(&pkgName, &providesName); err != nil {
			return false, fmt.Errorf("failed to scan provides: %w", err)
		}
		logger.Debug("Found provides entry",
			zap.String("package_name", pkgName),
			zap.String("provides_name", providesName),
			zap.String("package_version_id", oldPackageVersionID))
		possibleNames[pkgName] = struct{}{}
		possibleNames[providesName] = struct{}{}
	}

	return isPackageCoreForAPKOWithNames(apkoYAML, apkoTags, possibleNames, oldVersion)
}

// isPackageCoreForAPKOWithNames checks if a package is a core package for a given APKO
// A package is considered "core" if it appears in the APKO YAML with a pin that matches the oldVersion,
// and one of the APKO's tags matches the oldVersion (with or without "v" prefix)
func isPackageCoreForAPKOWithNames(apkoYAML string, apkoTags []string, possibleNames map[string]struct{}, oldVersion string) (bool, error) {
	// Parse the APKO YAML to check for package pins
	var imageConfig apkotypes.ImageConfiguration
	if err := yaml.Unmarshal([]byte(apkoYAML), &imageConfig); err != nil {
		return false, fmt.Errorf("failed to parse APKO YAML: %w", err)
	}

	logger.Debug("Checking package names",
		zap.Any("possible_names", possibleNames))

	// Check if any package in the APKO has a pin matching the oldVersion
	hasMatchingPin := false
	for _, pkg := range imageConfig.Contents.Packages {
		logger.Debug("Processing APKO package",
			zap.String("raw_package", pkg))
		// Parse the package name and version pin using apko's parser
		parsed := apkopackage.ResolvePackageNameVersionPin(pkg)

		// Check if this package name matches any of our possible names
		_, exists := possibleNames[parsed.Name]
		logger.Debug("Checking package pin",
			zap.String("parsed_name", parsed.Name),
			zap.String("parsed_version", parsed.Version),
			zap.String("old_version", oldVersion),
			zap.Bool("name_exists", exists))

		if exists && parsed.Version == oldVersion {
			logger.Debug("Found matching package pin",
				zap.String("package", parsed.Name),
				zap.String("version", parsed.Version),
				zap.String("original", pkg))
			hasMatchingPin = true
			break
		}
	}

	if !hasMatchingPin {
		return false, nil
	}

	// Check if any tag matches the version using semver comparison
	hasMatchingTag := false
	oldSemver, err := semver.ParseTolerant(oldVersion)
	if err != nil {
		return false, fmt.Errorf("failed to parse old version as semver: %w", err)
	}

	for _, tag := range apkoTags {
		tagSemver, err := semver.ParseTolerant(tag)
		if err != nil {
			logger.Debug("Failed to parse tag as semver",
				zap.String("tag", tag),
				zap.Error(err))
			continue
		}

		// Determine if this is a major.minor tag (like "2.8") or a full version tag (like "5.2.36")
		// by comparing the original tag to what a major.minor-only version would look like
		majorMinorTag := fmt.Sprintf("%d.%d", tagSemver.Major, tagSemver.Minor)
		isMajorMinorOnly := tag == majorMinorTag || tag == "v"+majorMinorTag

		if isMajorMinorOnly {
			// Tags like "2.8" match any patch version (2.8.0, 2.8.3, etc.)
			if tagSemver.Major == oldSemver.Major && tagSemver.Minor == oldSemver.Minor {
				hasMatchingTag = true
				break
			}
		} else {
			// Full version tags like "5.2.36" require exact match
			if tagSemver.Major == oldSemver.Major &&
				tagSemver.Minor == oldSemver.Minor &&
				tagSemver.Patch == oldSemver.Patch {
				hasMatchingTag = true
				break
			}
		}
	}

	if !hasMatchingTag {
		return false, nil
	}

	return true, nil
}

// GetImageTest retrieves the test YAML for a specific APKO ID and APKO version ID
// Returns empty string if no test exists
func GetImageTest(ctx context.Context, apkoID string, apkoVersionID string) (string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT yaml_content
		FROM image_test
		WHERE apko_id = $1 AND apko_version_id = $2
	`

	var testYAML string
	err := conn.QueryRow(ctx, query, apkoID, apkoVersionID).Scan(&testYAML)
	if err != nil {
		if err == pgx.ErrNoRows {
			// No test YAML exists, return empty string
			return "", nil
		}
		return "", fmt.Errorf("failed to get image test: %w", err)
	}

	return testYAML, nil
}
