package updater

import (
	"testing"

	"chainguard.dev/melange/pkg/config"
	"github.com/securebuildhq/securebuild/pkg/releasemonitor"
)

func TestFindLatestMatchingVersion(t *testing.T) {
	tests := []struct {
		name           string
		packageName    string
		packageVersion string
		filterPrefix   string
		filterContains string
		stableVersions []string
		want           string
		wantErr        bool
	}{
		{
			name:           "versioned package name - patch update",
			packageName:    "openjdk-21.0",
			packageVersion: "21.0.8",
			stableVersions: []string{
				"21.0.9",
				"21.0.8",
				"21.0.7",
				"21.1.0",
				"22.0.0",
			},
			want: "21.0.9",
		},
		{
			name:           "versioned package name - exact version match",
			packageName:    "su-exec-0.2",
			packageVersion: "0.2",
			stableVersions: []string{
				"0.2.1",
				"0.2.0",
				"0.3.0",
				"1.0.0",
			},
			want: "0.2.1",
		},
		{
			name:           "version-like suffix but not a version constraint",
			packageName:    "codes-21",
			packageVersion: "1.5.3",
			stableVersions: []string{
				"1.5.4",
				"1.5.3",
				"1.6.0",
				"2.0.0",
			},
			want: "1.5.4", // Should get latest patch since version in name doesn't match package version
		},
		{
			name:           "versioned package name - no matching versions",
			packageName:    "openjdk-20.0",
			packageVersion: "20.0.1",
			stableVersions: []string{
				"21.0.8",
				"21.0.7",
				"21.0.6",
				"21.1.0",
				"22.0.0",
			},
			want: "",
		},
		{
			name:         "explicit prefix filter",
			packageName:  "some-package",
			filterPrefix: "1.24.",
			stableVersions: []string{
				"1.24.7",
				"1.24.6",
				"1.24.5",
				"1.25.1",
				"1.23.12",
			},
			want: "1.24.7",
		},
		{
			name:           "explicit contains filter",
			packageName:    "some-package",
			filterContains: "beta",
			stableVersions: []string{
				"1.24.7",
				"1.24.6-beta",
				"1.24.5",
				"1.25.1-beta",
				"1.23.12",
			},
			want: "1.25.1-beta",
		},
		{
			name:        "no filters - use latest version",
			packageName: "some-package",
			stableVersions: []string{
				"1.25.1",
				"1.24.7",
				"1.24.6",
				"1.24.5",
				"1.23.12",
			},
			want: "1.25.1",
		},
		{
			name:        "invalid versions are skipped",
			packageName: "some-package",
			stableVersions: []string{
				"1.25.1",
				"1.24.7",
				"not-a-version",
				"1.24.5",
				"also-not-a-version",
			},
			want: "1.25.1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			compiled := &config.Configuration{
				Package: config.Package{
					Name:    tt.packageName,
					Version: tt.packageVersion,
				},
				Update: config.Update{
					ReleaseMonitor: &config.ReleaseMonitor{
						VersionFilterPrefix:   tt.filterPrefix,
						VersionFilterContains: tt.filterContains,
					},
				},
			}

			response := &releasemonitor.Response{
				LatestVersion:  tt.stableVersions[0], // First version is always the latest in our test data
				StableVersions: tt.stableVersions,
			}
			got, err := findLatestMatchingVersion(compiled, response)
			if (err != nil) != tt.wantErr {
				t.Errorf("findLatestMatchingVersion() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("findLatestMatchingVersion() = %v, want %v", got, tt.want)
			}
		})
	}
}
