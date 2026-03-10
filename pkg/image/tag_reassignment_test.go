package image

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCountVersionParts(t *testing.T) {
	tests := []struct {
		version  string
		expected int
	}{
		{"1", 1},
		{"v1", 1},
		{"V1", 1},
		{"1.0", 2},
		{"v1.0", 2},
		{"1.2.3", 3},
		{"v1.2.3", 3},
		{"1.2.3-rc1", 3}, // Ignores pre-release
		{"v1.2.3-alpha.2", 3},
		{"2.0.0-beta+metadata", 3},
	}

	for _, tt := range tests {
		t.Run(tt.version, func(t *testing.T) {
			result := countVersionParts(tt.version)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestComputeGlobalTagReassignments(t *testing.T) {
	tests := []struct {
		name     string
		apkos    []APKOTagInfo
		expected map[string][]string
	}{
		{
			name: "reassigns latest to highest version",
			apkos: []APKOTagInfo{
				{ID: "apko1", Tags: []string{"1.0.0", "1.0", "1", "latest"}},
				{ID: "apko2", Tags: []string{"1.1.0"}},
			},
			expected: map[string][]string{
				"apko1": {"1.0.0", "1.0"},
				"apko2": {"1.1.0", "1.1", "1", "latest"},
			},
		},
		{
			name: "handles multiple patch versions",
			apkos: []APKOTagInfo{
				{ID: "apko1", Tags: []string{"2.51.0", "2.51", "2", "latest"}},
				{ID: "apko2", Tags: []string{"2.51.1"}},
				{ID: "apko3", Tags: []string{"2.51.2"}},
			},
			expected: map[string][]string{
				"apko1": {"2.51.0"},
				"apko2": {"2.51.1"},
				"apko3": {"2.51.2", "2.51", "2", "latest"},
			},
		},
		{
			name: "no latest tag to reassign",
			apkos: []APKOTagInfo{
				{ID: "apko1", Tags: []string{"1.0.0"}},
				{ID: "apko2", Tags: []string{"1.1.0"}},
			},
			expected: map[string][]string{
				"apko1": {"1.0.0"},
				"apko2": {"1.1.0"},
			},
		},
		{
			name: "reassigns less specific tags across multiple minor versions",
			apkos: []APKOTagInfo{
				{ID: "apko1", Tags: []string{"1.0.0", "1.0", "1", "latest"}},
				{ID: "apko2", Tags: []string{"1.1.0", "1.1"}},
				{ID: "apko3", Tags: []string{"1.2.0"}},
			},
			expected: map[string][]string{
				"apko1": {"1.0.0", "1.0"},
				"apko2": {"1.1.0", "1.1"},
				"apko3": {"1.2.0", "1.2", "1", "latest"},
			},
		},
		{
			name: "handles version with v prefix",
			apkos: []APKOTagInfo{
				{ID: "apko1", Tags: []string{"v1.0.0", "v1.0", "v1", "latest"}},
				{ID: "apko2", Tags: []string{"v1.1.0"}},
			},
			expected: map[string][]string{
				"apko1": {"v1.0.0", "v1.0"},
				"apko2": {"v1.1.0", "v1.1", "v1", "latest"},
			},
		},
		{
			name: "preserves non-semver tags",
			apkos: []APKOTagInfo{
				{ID: "apko1", Tags: []string{"1.0.0", "custom-tag", "latest"}},
				{ID: "apko2", Tags: []string{"1.1.0"}},
			},
			expected: map[string][]string{
				"apko1": {"1.0.0", "custom-tag"},
				"apko2": {"1.1.0", "latest"},
			},
		},
		{
			name: "handles cross-major version tag reassignment",
			apkos: []APKOTagInfo{
				{ID: "apko1", Tags: []string{"1.5.0", "1.5", "1", "latest"}},
				{ID: "apko2", Tags: []string{"2.0.0", "2.0", "2"}},
			},
			expected: map[string][]string{
				"apko1": {"1.5.0", "1.5", "1"},
				"apko2": {"2.0.0", "2.0", "2", "latest"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := computeGlobalTagReassignments(tt.apkos)

			require.NoError(t, err)
			require.NotNil(t, result)

			// Verify each APKO has the expected tags
			for apkoID, expectedTags := range tt.expected {
				actualTags, ok := result[apkoID]
				require.True(t, ok, "APKO %s not found in result", apkoID)
				assert.ElementsMatch(t, expectedTags, actualTags, "Tags mismatch for APKO %s", apkoID)
			}

			// Verify no extra APKOs in result
			assert.Equal(t, len(tt.expected), len(result), "Number of APKOs in result doesn't match expected")
		})
	}
}
