package image

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"

	semver "github.com/Masterminds/semver/v3"
	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

// APKOTagInfo represents an APKO with its tags
type APKOTagInfo struct {
	ID      string
	Tags    []string
	GitTag  string // empty if not a linked image
}

// countVersionParts counts how many numeric parts a version string has (major, major.minor, or major.minor.patch)
// It uses regex to extract only the numeric version parts, ignoring pre-release and metadata suffixes
func countVersionParts(version string) int {
	// Strip any "v" or "V" prefix
	clean := strings.TrimPrefix(strings.TrimPrefix(version, "v"), "V")

	// Match numeric version parts: <number>, <number>.<number>, or <number>.<number>.<number>
	// This regex captures up to 3 numeric parts separated by dots
	re := regexp.MustCompile(`^(\d+)(?:\.(\d+))?(?:\.(\d+))?`)
	matches := re.FindStringSubmatch(clean)

	if len(matches) == 0 {
		return 0
	}

	// Count non-empty captured groups (excluding the full match at index 0)
	count := 0
	for i := 1; i < len(matches); i++ {
		if matches[i] != "" {
			count++
		}
	}

	return count
}

// reassignLatestTag moves the "latest" tag to the APKO with the greatest version
// Only reassigns if "latest" already exists in one of the APKOs
func reassignLatestTag(tagAssignments map[string][]string, apkoVersions map[string]*semver.Version, apkos []APKOTagInfo) {
	// Check if "latest" tag exists in any APKO
	hasLatestTag := false
	for _, apko := range apkos {
		if containsTag(apko.Tags, "latest") {
			hasLatestTag = true
			break
		}
	}

	if !hasLatestTag {
		logger.Debug("No 'latest' tag found in any APKO, skipping reassignment")
		return
	}

	// Find the APKO with the greatest version
	var greatestApkoID string
	var greatestVer *semver.Version

	for _, apko := range apkos {
		if ver, ok := apkoVersions[apko.ID]; ok {
			if greatestVer == nil || ver.GreaterThan(greatestVer) {
				greatestVer = ver
				greatestApkoID = apko.ID
			}
		}
	}

	if greatestApkoID == "" {
		return // No versioned APKOs found
	}

	logger.Debug("Reassigning 'latest' tag",
		zap.String("target_apko_id", greatestApkoID),
		zap.String("version", greatestVer.String()))

	// Remove "latest" from all APKOs
	for apkoID := range tagAssignments {
		tagAssignments[apkoID] = removeTag(tagAssignments[apkoID], "latest")
	}

	// Add "latest" to the APKO with the greatest version
	if !containsTag(tagAssignments[greatestApkoID], "latest") {
		tagAssignments[greatestApkoID] = append(tagAssignments[greatestApkoID], "latest")
	}
}

// reassignLessSpecificTags moves less specific tags (like "v1", "v1.3") to the APKO with the greatest version that satisfies the tag
// When a less-specific tag moves to a new APKO, it also generates equivalent tags for all part-counts that exist in the system
// Tags in the protectedTags set (git-derived OCI tags) are excluded from reassignment.
// TODO: figure out how to support tags with arbitrary prefixes.
func reassignLessSpecificTags(tagAssignments map[string][]string, apkoVersions map[string]*semver.Version, apkos []APKOTagInfo, protectedTags map[string]bool) {
	// Collect all unique less-specific tags across all APKOs and track part counts
	lessSpecificTags := make(map[string]bool)
	existingPartCounts := make(map[int]bool) // Track which part counts exist (1 or 2)
	versionPrefix := ""                      // Track prefix (v, V, or none)

	for _, apko := range apkos {
		for _, tag := range apko.Tags {
			if tag == "latest" {
				continue
			}
			// Skip git-derived tags — they must not be reassigned
			if protectedTags[tag] {
				continue
			}
			parts := countVersionParts(tag)
			// A tag is less specific if it has 1 or 2 parts
			if parts < 3 && parts > 0 {
				lessSpecificTags[tag] = true
				existingPartCounts[parts] = true

				// Determine version prefix from first tag we see
				if versionPrefix == "" {
					if strings.HasPrefix(tag, "v") {
						versionPrefix = "v"
					} else if strings.HasPrefix(tag, "V") {
						versionPrefix = "V"
					}
				}
			}
		}
	}

	logger.Debug("Found less-specific tags",
		zap.Int("count", len(lessSpecificTags)),
		zap.String("version_prefix", versionPrefix))

	// For each less-specific tag, find the greatest version that satisfies it
	for tag := range lessSpecificTags {
		// Parse the tag as a constraint
		cleanTag := strings.TrimPrefix(strings.TrimPrefix(tag, "v"), "V")
		tagParts := countVersionParts(tag)

		logger.Debug("Processing less-specific tag",
			zap.String("tag", tag),
			zap.String("clean_tag", cleanTag),
			zap.Int("tag_parts", tagParts))

		// Find the APKO with the greatest version that satisfies this tag
		var targetApkoID string
		var targetVer *semver.Version

		for _, apko := range apkos {
			ver, ok := apkoVersions[apko.ID]
			if !ok {
				continue
			}

			// Check if this version satisfies the tag
			if versionSatisfiesTag(ver, cleanTag) {
				if targetVer == nil || ver.GreaterThan(targetVer) {
					targetVer = ver
					targetApkoID = apko.ID
				}
			}
		}

		if targetApkoID == "" {
			logger.Debug("No APKO found to satisfy tag",
				zap.String("tag", tag))
			continue
		}

		logger.Debug("Reassigning less-specific tag",
			zap.String("tag", tag),
			zap.String("target_apko_id", targetApkoID),
			zap.String("target_version", targetVer.String()))

		// Remove this tag from all APKOs
		for apkoID := range tagAssignments {
			tagAssignments[apkoID] = removeTag(tagAssignments[apkoID], tag)
		}

		// Add the tag to the target APKO
		if !containsTag(tagAssignments[targetApkoID], tag) {
			tagAssignments[targetApkoID] = append(tagAssignments[targetApkoID], tag)
		}

		// Generate equivalent tags for all part counts that exist in the system
		// E.g., if "1" moves to 1.2.0 and system has both 1-part and 2-part tags, generate "1.2"
		// Only generate if the equivalent tag doesn't already exist (or will be assigned to this APKO)
		for partCount := range existingPartCounts {
			if partCount != tagParts { // Don't generate for the same part count as the tag
				equivalentTag := generateEquivalentTag(targetVer, partCount, versionPrefix)
				if equivalentTag != "" && !containsTag(tagAssignments[targetApkoID], equivalentTag) {
					// Check if this equivalent tag already exists in lessSpecificTags
					// If it does, it will be reassigned separately, so don't generate it here
					if !lessSpecificTags[equivalentTag] {
						logger.Debug("Generated equivalent tag",
							zap.String("tag", equivalentTag),
							zap.String("target_apko_id", targetApkoID),
							zap.Int("parts", partCount))
						tagAssignments[targetApkoID] = append(tagAssignments[targetApkoID], equivalentTag)
					}
				}
			}
		}
	}
}

// generateEquivalentTag generates a version tag with the specified number of parts
// E.g., version 1.2.3 with 2 parts and "v" prefix -> "v1.2"
func generateEquivalentTag(ver *semver.Version, parts int, prefix string) string {
	if parts == 1 {
		return fmt.Sprintf("%s%d", prefix, ver.Major())
	} else if parts == 2 {
		return fmt.Sprintf("%s%d.%d", prefix, ver.Major(), ver.Minor())
	}
	// For 3 parts, return the full version
	return fmt.Sprintf("%s%d.%d.%d", prefix, ver.Major(), ver.Minor(), ver.Patch())
}

// versionSatisfiesTag checks if a version satisfies a less-specific tag
// For example, version "1.3.4" satisfies tags "1" and "1.3"
func versionSatisfiesTag(ver *semver.Version, tag string) bool {
	tagParts := strings.Split(tag, ".")

	if len(tagParts) >= 1 {
		majorStr := fmt.Sprintf("%d", ver.Major())
		if majorStr != tagParts[0] {
			return false
		}
	}

	if len(tagParts) >= 2 {
		minorStr := fmt.Sprintf("%d", ver.Minor())
		if minorStr != tagParts[1] {
			return false
		}
	}

	return true
}

// containsTag checks if a tag slice contains a specific tag
func containsTag(tags []string, tag string) bool {
	for _, t := range tags {
		if t == tag {
			return true
		}
	}
	return false
}

// removeTag removes a tag from a tag slice
func removeTag(tags []string, tag string) []string {
	result := make([]string, 0, len(tags))
	for _, t := range tags {
		if t != tag {
			result = append(result, t)
		}
	}
	return result
}

// ReassignTagsForImage performs tag reassignment for a single image
// NOTE: Caller must manage transactions. This function does NOT begin/commit transactions.
// It expects conn to be either a standalone connection or part of an existing transaction.
func ReassignTagsForImage(ctx context.Context, tx pgx.Tx, imageID string) error {
	// Fetch all APKOs for this image
	query := `
		SELECT ia.id, ia.tags, ia.git_tag
		FROM image_apko ia
		WHERE ia.image_id = $1
		ORDER BY ia.created_at ASC
	`
	rows, err := tx.Query(ctx, query, imageID)
	if err != nil {
		return fmt.Errorf("failed to query APKOs: %w", err)
	}
	defer rows.Close()

	var apkos []APKOTagInfo
	for rows.Next() {
		var apko APKOTagInfo
		var gitTag sql.NullString
		if err := rows.Scan(&apko.ID, &apko.Tags, &gitTag); err != nil {
			return fmt.Errorf("failed to scan APKO row: %w", err)
		}
		apko.GitTag = gitTag.String
		apkos = append(apkos, apko)
	}

	if len(apkos) == 0 {
		logger.Debug("No APKOs found for image",
			zap.String("image_id", imageID))
		return nil
	}

	// Perform global tag reassignment across all APKOs
	newTagAssignments, err := computeGlobalTagReassignments(apkos)
	if err != nil {
		return fmt.Errorf("failed to compute tag reassignments: %w", err)
	}

	// Update tags (caller manages transaction)
	for apkoID, tags := range newTagAssignments {
		_, err := tx.Exec(ctx, `UPDATE image_apko SET tags = $1 WHERE id = $2`, tags, apkoID)
		if err != nil {
			return fmt.Errorf("failed to update tags for APKO %s: %w", apkoID, err)
		}
	}

	logger.Info("Successfully reassigned tags for image",
		zap.String("image_id", imageID),
		zap.Int("apko_count", len(newTagAssignments)))

	return nil
}

// computeGlobalTagReassignments recalculates optimal tags based on current APKO state
// This is a pure function (no I/O) that can be unit tested
// Git-derived OCI tags (those matching a git_tag on an image_apko) are excluded from reassignment.
func computeGlobalTagReassignments(apkos []APKOTagInfo) (map[string][]string, error) {
	// Build set of git-derived tags that must not be reassigned
	protectedTags := make(map[string]bool)
	for _, apko := range apkos {
		if apko.GitTag != "" {
			protectedTags[apko.GitTag] = true
		}
	}

	// Build version map
	apkoVersions := make(map[string]*semver.Version)
	for _, apko := range apkos {
		// Find most specific version tag
		var mostSpecificVer *semver.Version
		maxParts := 0
		for _, tag := range apko.Tags {
			if tag == "latest" {
				continue
			}
			if ver, err := semver.NewVersion(tag); err == nil {
				parts := countVersionParts(ver.Original())
				if parts > maxParts {
					mostSpecificVer = ver
					maxParts = parts
				}
			}
		}
		if mostSpecificVer != nil {
			apkoVersions[apko.ID] = mostSpecificVer
		}
	}

	// Initialize with existing tags
	newTagAssignments := make(map[string][]string)
	for _, apko := range apkos {
		newTagAssignments[apko.ID] = apko.Tags
	}

	// Reassign "latest" to APKO with greatest version
	reassignLatestTag(newTagAssignments, apkoVersions, apkos)

	// Reassign less specific tags (e.g., "1", "1.2"), excluding git-derived tags
	reassignLessSpecificTags(newTagAssignments, apkoVersions, apkos, protectedTags)

	return newTagAssignments, nil
}
