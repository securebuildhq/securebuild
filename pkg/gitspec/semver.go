package gitspec

import (
	"fmt"
	"strings"

	"github.com/Masterminds/semver"
)

// OverrideVersionAndEpochInMelange replaces the version and epoch fields in the
// melange YAML using a line-by-line approach that preserves the original formatting.
// Only the first occurrence of each field is replaced. The git tag is the
// authoritative source of the version; the melange file's own package.version
// and package.epoch are overridden.
// Returns the modified YAML content and the version string derived from the tag.
func OverrideVersionAndEpochInMelange(melangeYAML string, gitTag string, epoch int) (string, string, error) {
	v, err := semver.NewVersion(gitTag)
	if err != nil {
		return "", "", fmt.Errorf("parse git tag %q as semver: %w", gitTag, err)
	}

	if v.Prerelease() != "" {
		return "", "", fmt.Errorf("pre-release tags are not supported (tag=%q)", gitTag)
	}

	versionStr := v.String()

	lines := strings.Split(melangeYAML, "\n")
	versionReplaced := false
	epochReplaced := false

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		leadingWhitespace := line[:len(line)-len(trimmed)]

		if !versionReplaced && strings.HasPrefix(trimmed, "version:") {
			lines[i] = fmt.Sprintf("%sversion: %q", leadingWhitespace, versionStr)
			versionReplaced = true
		}

		if !epochReplaced && strings.HasPrefix(trimmed, "epoch:") {
			lines[i] = fmt.Sprintf("%sepoch: %d", leadingWhitespace, epoch)
			epochReplaced = true
		}

		if versionReplaced && epochReplaced {
			break
		}
	}

	return strings.Join(lines, "\n"), versionStr, nil
}

// VersionFromTag parses a git tag as semver and returns the canonical version string.
func VersionFromTag(gitTag string) (string, error) {
	v, err := semver.NewVersion(gitTag)
	if err != nil {
		return "", fmt.Errorf("parse git tag %q as semver: %w", gitTag, err)
	}
	if v.Prerelease() != "" {
		return "", fmt.Errorf("pre-release tags are not supported (tag=%q)", gitTag)
	}
	return v.String(), nil
}

// IsSemverTag returns true if the given string is a valid semver tag (with optional v prefix).
func IsSemverTag(tag string) bool {
	_, err := semver.NewVersion(tag)
	return err == nil
}
