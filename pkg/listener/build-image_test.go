package listener

import (
	"testing"

	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
)

func TestExecuteTemplate(t *testing.T) {
	// Sample packages data
	packages := []imagetypes.APKPackageVersion{
		{
			Name:               "postgresql-17",
			Version:            "17.1.0",
			VersionWithRelease: "17.1.0-r1",
			Major:              "17",
			Minor:              "1",
			Patch:              "0",
			Release:            "r1",
		},
		{
			Name:               "nginx",
			Version:            "1.24.0",
			VersionWithRelease: "1.24.0-r2",
			Major:              "1",
			Minor:              "24",
			Patch:              "0",
			Release:            "r2",
		},
	}

	tests := []struct {
		name     string
		tag      string
		expected string
		wantErr  bool
	}{
		{
			name:     "latest literal",
			tag:      "latest",
			expected: "latest",
			wantErr:  false,
		},
		{
			name:     "major version with hyphen in package name",
			tag:      `{{ index .Packages "postgresql-17" | semver "major" }}`,
			expected: "17",
			wantErr:  false,
		},
		{
			name:     "major.minor version",
			tag:      `{{ index .Packages "postgresql-17" | semver "major" }}.{{ index .Packages "postgresql-17" | semver "minor" }}`,
			expected: "17.1",
			wantErr:  false,
		},
		{
			name:     "simple package name",
			tag:      `{{ index .Packages "nginx" | semver "major" }}`,
			expected: "1",
			wantErr:  false,
		},
		{
			name:     "full version",
			tag:      `{{ index .Packages "nginx" | semver "version" }}`,
			expected: "1.24.0",
			wantErr:  false,
		},
		{
			name:     "version with release",
			tag:      `{{ index .Packages "nginx" | semver "version" }}-{{ index .Packages "nginx" | semver "release" }}`,
			expected: "1.24.0-r2",
			wantErr:  false,
		},
		{
			name:     "error case - lowercase packages (should fail)",
			tag:      `{{ index .packages "postgresql-17" | semver "major" }}`,
			expected: "",
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := executeTemplate(tt.tag, packages)
			if (err != nil) != tt.wantErr {
				t.Errorf("executeTemplate() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if result != tt.expected {
				t.Errorf("executeTemplate() = %v, want %v", result, tt.expected)
			}
		})
	}
}
