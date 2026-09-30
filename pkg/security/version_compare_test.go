package security

import (
	"testing"
)

func TestGoModuleFixDetection(t *testing.T) {
	tests := []struct {
		name    string
		version string
		fixes   []string
		want    bool
	}{
		{"Thrift newer minor contains fix", "v0.24.0", []string{"0.23.0"}, true},
		{"Thrift vulnerable minor", "v0.22.0", []string{"0.23.0"}, false},
		{"Thrift exact fix", "v0.23.0", []string{"0.23.0"}, true},
		{"crypto newer minor contains fix", "v0.56.0", []string{"0.52.0"}, true},
		{"grpc newer minor contains fix", "v1.83.1", []string{"1.82.1"}, true},
		{"grpc vulnerable parallel branch", "v1.83.1", []string{"1.82.2", "1.83.2"}, false},
		{"grpc patched parallel branch", "v1.82.3", []string{"1.83.2", "1.82.2"}, true},
		{"newer minor after parallel fixes", "v1.84.0", []string{"1.83.2", "1.82.2"}, true},
		{"prerelease before its branch fix", "v1.83.2-rc.1", []string{"1.82.2", "1.83.2"}, false},
		{"multiple fixes in selected branch", "v1.83.2", []string{"1.83.3", "1.82.2", "1.83.2"}, true},
		{"stdlib vulnerable parallel branch", "go1.25.6", []string{"1.24.13", "1.25.7"}, false},
		{"stdlib newer minor contains fix", "go1.27.1", []string{"1.25.13", "1.26.6"}, true},
		{"different major is not evidence of a fix", "v2.0.0", []string{"1.23.0"}, false},
		{"no fixes", "v0.24.0", nil, false},
		{"invalid fix is ignored", "v0.24.0", []string{"invalid", "0.23.0"}, true},
		{"invalid fixes alone are not evidence", "v0.24.0", []string{"invalid"}, false},
		{"pseudo version before fix", "v0.0.0-20260101000000-aaaaaaaaaaaa", []string{"v0.0.0-20260201000000-bbbbbbbbbbbb"}, false},
		{"pseudo version after fix", "v0.0.0-20260301000000-cccccccccccc", []string{"v0.0.0-20260201000000-bbbbbbbbbbbb"}, true},
		{"Go build metadata preserves branch selection", "v1.83.1+incompatible+dirty", []string{"1.82.2", "1.83.2"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ArtifactVersionSatisfiesAnyFix(tt.version, tt.fixes, "go-module")
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Fatalf("version %s, fixes %v: got %v, want %v", tt.version, tt.fixes, got, tt.want)
			}
		})
	}
}

func TestArtifactVersionSatisfiesAnyFix(t *testing.T) {
	tests := []struct {
		name            string
		artifactVersion string
		fixedVersions   []string
		artifactType    string
		want            bool
		wantErr         bool
	}{
		{
			name:            "Redis 7.4.5 NOT fixed (requires 7.4.6)",
			artifactVersion: "7.4.5",
			fixedVersions:   []string{"6.2.20", "7.2.11", "7.4.6", "8.0.4", "8.2.2"},
			artifactType:    "apk",
			want:            false,
		},
		{
			name:            "Redis 8.0.3 NOT fixed (requires 8.0.4)",
			artifactVersion: "8.0.3",
			fixedVersions:   []string{"6.2.20", "7.2.11", "7.4.6", "8.0.4", "8.2.2"},
			artifactType:    "apk",
			want:            false,
		},
		{
			name:            "Redis 7.4.7 IS fixed",
			artifactVersion: "7.4.7",
			fixedVersions:   []string{"6.2.20", "7.2.11", "7.4.6", "8.0.4", "8.2.2"},
			artifactType:    "apk",
			want:            true,
		},
		{
			name:            "Redis 8.0.4 IS fixed",
			artifactVersion: "8.0.4",
			fixedVersions:   []string{"6.2.20", "7.2.11", "7.4.6", "8.0.4", "8.2.2"},
			artifactType:    "apk",
			want:            true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ArtifactVersionSatisfiesAnyFix(
				tt.artifactVersion,
				tt.fixedVersions,
				tt.artifactType,
			)

			if (err != nil) != tt.wantErr {
				t.Errorf("ArtifactVersionSatisfiesAnyFix() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if got != tt.want {
				t.Errorf("ArtifactVersionSatisfiesAnyFix() = %v, want %v (version=%s, fixes=%v, type=%s)",
					got, tt.want, tt.artifactVersion, tt.fixedVersions, tt.artifactType)
			}
		})
	}
}
