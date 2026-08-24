package gitspec

import (
	"strings"
	"testing"
)

func TestOverrideVersionAndEpochInMelange(t *testing.T) {
	tests := []struct {
		name            string
		tag             string
		wantVersion     string
		wantYAMLVersion string
	}{
		{
			name:            "stable version",
			tag:             "v2.19.5",
			wantVersion:     "2.19.5",
			wantYAMLVersion: `version: "2.19.5"`,
		},
		{
			name:            "build metadata",
			tag:             "2.19.5+k8s-1.36",
			wantVersion:     "2.19.5+k8s-1.36",
			wantYAMLVersion: `version: "2.19.5+k8s-1.36"`,
		},
	}

	const input = "package:\n  name: example\n  version: 0.0.0\n  epoch: 7\n"
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotYAML, gotVersion, err := OverrideVersionAndEpochInMelange(input, tt.tag, 0, "")
			if err != nil {
				t.Fatalf("OverrideVersionAndEpochInMelange() error = %v", err)
			}
			if gotVersion != tt.wantVersion {
				t.Errorf("version = %q, want %q", gotVersion, tt.wantVersion)
			}
			if !strings.Contains(gotYAML, tt.wantYAMLVersion) {
				t.Errorf("YAML = %q, want it to contain %q", gotYAML, tt.wantYAMLVersion)
			}
		})
	}
}

func TestOverrideVersionAndEpochInMelangeRejectsPrerelease(t *testing.T) {
	const input = "package:\n  version: 0.0.0\n  epoch: 0\n"
	if _, _, err := OverrideVersionAndEpochInMelange(input, "v2.19.5-rc.1+k8s-1.36", 0, ""); err == nil {
		t.Fatal("OverrideVersionAndEpochInMelange() expected prerelease error")
	}
}

func TestVersionFromTagReturnsMelangeVersion(t *testing.T) {
	got, err := VersionFromTag("v2.19.5-rc.1+k8s-1.36")
	if err != nil {
		t.Fatalf("VersionFromTag() error = %v", err)
	}
	if want := "2.19.5"; got != want {
		t.Errorf("VersionFromTag() = %q, want %q", got, want)
	}
}
