package listener

import (
	"testing"

	"github.com/Masterminds/semver"
)

func TestClassifyVersionChange(t *testing.T) {
	tests := []struct {
		name     string
		oldVer   string
		newVer   string
		expected VersionChangeType
	}{
		{
			name:     "patch update",
			oldVer:   "2.51.0",
			newVer:   "2.51.1",
			expected: VersionChangePatch,
		},
		{
			name:     "minor update",
			oldVer:   "2.51.0",
			newVer:   "2.52.0",
			expected: VersionChangeMinor,
		},
		{
			name:     "major update",
			oldVer:   "2.51.0",
			newVer:   "3.0.0",
			expected: VersionChangeMinor, // Major counts as Minor for our purposes
		},
		{
			name:     "multiple patch jumps",
			oldVer:   "1.0.0",
			newVer:   "1.0.5",
			expected: VersionChangePatch,
		},
		{
			name:     "zero to one patch",
			oldVer:   "1.0.0",
			newVer:   "1.0.1",
			expected: VersionChangePatch,
		},
		{
			name:     "minor with patch",
			oldVer:   "1.0.5",
			newVer:   "1.1.0",
			expected: VersionChangeMinor,
		},
		{
			name:     "major with minor and patch",
			oldVer:   "1.2.3",
			newVer:   "2.0.0",
			expected: VersionChangeMinor,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			oldVer, err := semver.NewVersion(tt.oldVer)
			if err != nil {
				t.Fatalf("invalid old version: %v", err)
			}
			newVer, err := semver.NewVersion(tt.newVer)
			if err != nil {
				t.Fatalf("invalid new version: %v", err)
			}

			result := classifyVersionChange(oldVer, newVer)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}
