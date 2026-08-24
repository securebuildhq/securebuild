package gitspec

import (
	"fmt"
	"strings"

	"github.com/Masterminds/semver"
)

// OverrideVersionAndEpochInMelange replaces the name, version, and epoch fields in the
// melange YAML using a line-by-line approach that preserves the original formatting.
// Only the first occurrence of each field is replaced. The git tag is the
// authoritative source of the version; the melange file's own package.name,
// package.version, and package.epoch are overridden.
// packageName is generated from the package family's name template.
// Returns the modified YAML content and the version string derived from the tag.
func OverrideVersionAndEpochInMelange(melangeYAML string, gitTag string, epoch int, packageName string) (string, string, error) {
	v, err := semver.NewVersion(gitTag)
	if err != nil {
		return "", "", fmt.Errorf("parse git tag %q as semver: %w", gitTag, err)
	}

	if v.Prerelease() != "" {
		return "", "", fmt.Errorf("pre-release tags are not supported (tag=%q)", gitTag)
	}

	versionStr := v.String()

	lines := strings.Split(melangeYAML, "\n")
	nameReplaced := false
	versionReplaced := false
	epochReplaced := false

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		leadingWhitespace := line[:len(line)-len(trimmed)]

		if !nameReplaced && packageName != "" && strings.HasPrefix(trimmed, "name:") {
			lines[i] = fmt.Sprintf("%sname: %q", leadingWhitespace, packageName)
			nameReplaced = true
		}

		if !versionReplaced && strings.HasPrefix(trimmed, "version:") {
			lines[i] = fmt.Sprintf("%sversion: %q", leadingWhitespace, versionStr)
			versionReplaced = true
		}

		if !epochReplaced && strings.HasPrefix(trimmed, "epoch:") {
			lines[i] = fmt.Sprintf("%sepoch: %d", leadingWhitespace, epoch)
			epochReplaced = true
		}

		if nameReplaced && versionReplaced && epochReplaced {
			break
		}
	}

	return strings.Join(lines, "\n"), versionStr, nil
}

// VersionFromTag parses a git tag as semver and returns only its major, minor, and
// patch components, suitable for use as a Melange package version.
func VersionFromTag(gitTag string) (string, error) {
	v, err := semver.NewVersion(gitTag)
	if err != nil {
		return "", fmt.Errorf("parse git tag %q as semver: %w", gitTag, err)
	}
	return fmt.Sprintf("%d.%d.%d", v.Major(), v.Minor(), v.Patch()), nil
}

// IsSemverTag returns true if the given string is a valid semver tag (with optional v prefix).
func IsSemverTag(tag string) bool {
	_, err := semver.NewVersion(tag)
	return err == nil
}
