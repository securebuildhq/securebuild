package security

import (
	"fmt"

	"github.com/Masterminds/semver/v3"
	"github.com/anchore/grype/grype/version"
)

// ArtifactVersionSatisfiesAnyFix checks if an artifact version >= the fixed version in the same major.minor stream.
// This is used to determine if a specific artifact version contains a security fix.
//
// Fixed versions often contain multiple versions for different release streams:
//   - fixedVersions: ["6.2.20", "7.2.11", "7.4.6", "8.0.4", "8.2.2"]
//   - artifactVersion: "7.4.5" should compare against "7.4.6" (same 7.4.x stream)
//   - Returns: false (because 7.4.5 < 7.4.6)
//
// The function filters fixed versions to only those matching the artifact's major.minor,
// then checks if the artifact version >= the lowest fixed version in that stream.
func ArtifactVersionSatisfiesAnyFix(
	artifactVersion string,
	fixedVersions []string,
	artifactType string,
) (bool, error) {
	format := version.ParseFormat(artifactType)

	v := version.New(artifactVersion, format)
	if err := v.Validate(); err != nil {
		return false, fmt.Errorf("invalid version %q: %w", artifactVersion, err)
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

// compareAgainstAllFixedVersions is the fallback when semver parsing fails
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
