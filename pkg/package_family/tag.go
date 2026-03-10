package package_family

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/Masterminds/semver"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

func GenerateImageTag(template, version string) string {
	if template == "" {
		return version
	}

	parsed, err := semver.NewVersion(version)
	if err != nil {
		logger.Warn("Failed to parse version as semver, using version as is", zap.String("version", version), zap.Error(err))
		return version
	}

	result := template
	result = strings.ReplaceAll(result, "{major}", strconv.FormatInt(parsed.Major(), 10))
	result = strings.ReplaceAll(result, "{minor}", strconv.FormatInt(parsed.Minor(), 10))
	result = strings.ReplaceAll(result, "{patch}", strconv.FormatInt(parsed.Patch(), 10))
	return result
}

// DeriveTagTemplate derives a tag template from an old tag and old version
// It identifies the prefix and suffix by matching the version components in the tag
// Returns the template string, number of components matched (1-3), or empty string and 0 if it cannot derive one
func DeriveTagTemplate(oldTag, oldVersion string) (string, int) {
	// Parse the old version
	parsed, err := semver.NewVersion(oldVersion)
	if err != nil {
		logger.Debug("Failed to parse old version as semver",
			zap.String("old_version", oldVersion),
			zap.Error(err))
		return "", 0
	}

	// Strip optional "v" prefix from the tag
	prefix := ""
	strippedTag := oldTag
	if strings.HasPrefix(oldTag, "v") {
		prefix = "v"
		strippedTag = strings.TrimPrefix(oldTag, "v")
	}

	// Generate three version strings to check (most specific first)
	versions := []struct {
		str        string
		template   string
		components int
	}{
		{fmt.Sprintf("%d.%d.%d", parsed.Major(), parsed.Minor(), parsed.Patch()), "{major}.{minor}.{patch}", 3},
		{fmt.Sprintf("%d.%d", parsed.Major(), parsed.Minor()), "{major}.{minor}", 2},
		{fmt.Sprintf("%d", parsed.Major()), "{major}", 1},
	}

	// For each version string, check if it's a prefix followed by separator or nothing
	for _, v := range versions {
		if strippedTag == v.str {
			// Exact match, no suffix
			return prefix + v.template, v.components
		}
		if strings.HasPrefix(strippedTag, v.str+"-") {
			// Prefix followed by hyphen
			suffix := strings.TrimPrefix(strippedTag, v.str+"-")
			return prefix + v.template + "-" + suffix, v.components
		}
		if strings.HasPrefix(strippedTag, v.str+"+") {
			// Prefix followed by plus
			suffix := strings.TrimPrefix(strippedTag, v.str+"+")
			return prefix + v.template + "+" + suffix, v.components
		}
	}

	logger.Debug("Could not derive tag template",
		zap.String("old_tag", oldTag),
		zap.String("old_version", oldVersion))
	return "", 0
}

// DeriveTagTemplateFromTags derives the most specific tag template from a list of tags
// It tries each tag and returns the template with the most version components
// Tags that cannot be parsed as semver are automatically skipped
// Returns the template and the number of components
func DeriveTagTemplateFromTags(tags []string, oldVersion string) (template string, components int) {
	var bestTemplate string
	maxComponents := 0

	for _, tag := range tags {
		// Try to parse the tag as semver to filter out non-version tags
		if _, err := semver.NewVersion(tag); err != nil {
			// Skip tags that aren't valid semver (like "latest", "stable", etc.)
			continue
		}

		derivedTemplate, numComponents := DeriveTagTemplate(tag, oldVersion)
		if numComponents > maxComponents {
			maxComponents = numComponents
			bestTemplate = derivedTemplate
		}
	}

	return bestTemplate, maxComponents
}
