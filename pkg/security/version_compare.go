package security

import (
	"fmt"
	"strings"

	"github.com/Masterminds/semver/v3"
	"github.com/anchore/grype/grype/version"
)

// ArtifactVersionSatisfiesAnyFix checks whether an artifact contains a recorded fix.
// This is used to determine if a specific artifact version contains a security fix.
//
// Go modules may inherit fixes from earlier minor releases within the same major.
// When multiple release branches have fixes, the newest branch at or below the
// installed minor governs: grpc 1.83.1 is not fixed by [1.82.2, 1.83.2].
// Other ecosystems retain same-major.minor release-stream matching.
//
// Fixed versions often contain multiple versions for different release streams:
//   - fixedVersions: ["6.2.20", "7.2.11", "7.4.6", "8.0.4", "8.2.2"]
//   - artifactVersion: "7.4.5" should compare against "7.4.6" (same 7.4.x stream)
//   - Returns: false (because 7.4.5 < 7.4.6)
func ArtifactVersionSatisfiesAnyFix(
	artifactVersion string,
	fixedVersions []string,
	artifactType string,
) (bool, error) {
	format := version.ParseFormat(artifactType)
	// Grype does not recognize Syft's "go-module" package type as a Go version format.
	if artifactType == "go-module" {
		format = version.GolangFormat
	}

	v := version.New(artifactVersion, format)
	if err := v.Validate(); err != nil {
		return false, fmt.Errorf("invalid version %q: %w", artifactVersion, err)
	}

	if format == version.GolangFormat {
		return goModuleVersionSatisfiesFix(v, fixedVersions)
	}

	// Parse artifact version as semver to get major.minor
	artifactSemver, err := semver.NewVersion(artifactVersion)
	if err != nil {
		// If not semver, fall back to comparing against all fixed versions
		return compareAgainstAllFixedVersions(v, fixedVersions, format)
	}

	artifactMajorMinor := fmt.Sprintf("%d.%d", artifactSemver.Major(), artifactSemver.Minor())

	// Filter fixed versions to those in the same major.minor stream
	var matchingFixedVersions []string
	for _, fixedVersion := range fixedVersions {
		fixedSemver, err := semver.NewVersion(fixedVersion)
		if err != nil {
			// Can't parse as semver, skip
			continue
		}

		fixedMajorMinor := fmt.Sprintf("%d.%d", fixedSemver.Major(), fixedSemver.Minor())
		if artifactMajorMinor == fixedMajorMinor {
			matchingFixedVersions = append(matchingFixedVersions, fixedVersion)
		}
	}

	// If no matching fixed versions in the same stream, not fixed
	if len(matchingFixedVersions) == 0 {
		return false, nil
	}

	// Check if artifact version >= any of the matching fixed versions
	for _, fixedVersion := range matchingFixedVersions {
		fixVer := version.New(fixedVersion, format)

		result, err := v.Compare(fixVer)
		if err != nil {
			continue
		}

		if result >= 0 {
			// Artifact version >= fixed version in same stream
			return true, nil
		}
	}

	return false, nil
}

// goModuleVersionSatisfiesFix selects the newest applicable minor branch before
// comparing patch/prerelease versions. Comparing against any older branch's fix
// would incorrectly mark an unpatched parallel branch as fixed.
func goModuleVersionSatisfiesFix(v *version.Version, fixedVersions []string) (bool, error) {
	installed, err := parseGoModuleSemver(v.Raw)
	if err != nil {
		return false, fmt.Errorf("invalid Go module version %q: %w", v.Raw, err)
	}

	var matchingFixes []string
	var newestMinor uint64
	for _, fixedVersion := range fixedVersions {
		fixed, err := parseGoModuleSemver(fixedVersion)
		if err != nil || fixed.Major() != installed.Major() || fixed.Minor() > installed.Minor() {
			continue
		}
		if len(matchingFixes) == 0 || fixed.Minor() > newestMinor {
			newestMinor = fixed.Minor()
			matchingFixes = []string{fixedVersion}
		} else if fixed.Minor() == newestMinor {
			matchingFixes = append(matchingFixes, fixedVersion)
		}
	}
	return compareAgainstAllFixedVersions(v, matchingFixes, version.GolangFormat)
}

func parseGoModuleSemver(raw string) (*semver.Version, error) {
	// Match Grype's normalization for stdlib versions and Go 1.24+ build metadata.
	normalized := strings.TrimPrefix(raw, "go")
	if before, after, found := strings.Cut(normalized, "+"); found {
		normalized = before + "+" + strings.ReplaceAll(after, "+", ".")
	}
	return semver.NewVersion(normalized)
}

// compareAgainstAllFixedVersions compares against the selected release branch,
// or all fixes when a non-Go artifact cannot be parsed as semver.
func compareAgainstAllFixedVersions(v *version.Version, fixedVersions []string, format version.Format) (bool, error) {
	for _, fixedVersion := range fixedVersions {
		fixVer := version.New(fixedVersion, format)

		result, err := v.Compare(fixVer)
		if err != nil {
			continue
		}

		if result >= 0 {
			return true, nil
		}
	}
	return false, nil
}
