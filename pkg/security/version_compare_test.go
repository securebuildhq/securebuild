package security

import (
	"testing"
)

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
