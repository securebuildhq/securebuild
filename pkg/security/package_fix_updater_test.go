package security

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDeduplicateVersionsByPrefix(t *testing.T) {
	// Start with a mix of versions across different major.minor.patch releases
	existingVersions := []string{
		"8.0.3-r4",  // Should be replaced by 8.0.3-r2
		"8.0.4-r1",  // Keep
		"7.4.5-r3",  // Keep
		"8.2.1-r0",  // Keep
		"1.6.51-r0", // Keep
	}

	// Add various new versions
	testCases := []struct {
		newVersion string
		expected   []string
	}{
		{
			newVersion: "8.0.3-r2", // Lower than existing 8.0.3-r4, should replace
			expected: []string{
				"1.6.51-r0",
				"7.4.5-r3",
				"8.0.3-r2", // Replaced 8.0.3-r4
				"8.0.4-r1",
				"8.2.1-r0",
			},
		},
		{
			newVersion: "8.0.5-r0", // New major.minor.patch
			expected: []string{
				"1.6.51-r0",
				"7.4.5-r3",
				"8.0.3-r2",
				"8.0.4-r1",
				"8.0.5-r0", // Added
				"8.2.1-r0",
			},
		},
		{
			newVersion: "8.0.3-r5", // Higher than 8.0.3-r2, should be skipped
			expected: []string{
				"1.6.51-r0",
				"7.4.5-r3",
				"8.0.3-r2", // Kept, didn't replace
				"8.0.4-r1",
				"8.0.5-r0",
				"8.2.1-r0",
			},
		},
		{
			newVersion: "9.0.0-r1", // New major version
			expected: []string{
				"1.6.51-r0",
				"7.4.5-r3",
				"8.0.3-r2",
				"8.0.4-r1",
				"8.0.5-r0",
				"8.2.1-r0",
				"9.0.0-r1", // Added
			},
		},
	}

	current := existingVersions
	for _, tc := range testCases {
		t.Run("add_"+tc.newVersion, func(t *testing.T) {
			result := deduplicateVersionsByPrefix(current, tc.newVersion)
			assert.Equal(t, tc.expected, result, "Version deduplication mismatch for "+tc.newVersion)
			current = result // Chain the results for next test
		})
	}
}
