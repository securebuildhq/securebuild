package package_family

import (
	"testing"
)

func TestGenerateImageTag(t *testing.T) {
	tests := []struct {
		name     string
		template string
		version  string
		want     string
	}{
		{
			name:     "empty template returns version",
			template: "",
			version:  "1.2.3",
			want:     "1.2.3",
		},
		{
			name:     "full template with all parts",
			template: "v{major}.{minor}.{patch}",
			version:  "1.2.3",
			want:     "v1.2.3",
		},
		{
			name:     "template with suffix",
			template: "v{major}.{minor}.{patch}-fips",
			version:  "1.2.3",
			want:     "v1.2.3-fips",
		},
		{
			name:     "template with only major and minor",
			template: "v{major}.{minor}",
			version:  "1.2.3",
			want:     "v1.2",
		},
		{
			name:     "template with only major",
			template: "v{major}",
			version:  "1.2.3",
			want:     "v1",
		},
		{
			name:     "derived template example from proposal",
			template: "v{major}.{minor}.{patch}-fips",
			version:  "1.2.4",
			want:     "v1.2.4-fips",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GenerateImageTag(tt.template, tt.version)
			if got != tt.want {
				t.Errorf("GenerateImageTag(%q, %q) = %q, want %q", tt.template, tt.version, got, tt.want)
			}
		})
	}
}

func TestDeriveTagTemplateFromTags(t *testing.T) {
	tests := []struct {
		name           string
		tags           []string
		oldVersion     string
		wantTemplate   string
		wantComponents int
	}{
		{
			name: "selects most specific tag with 3 components",
			tags: []string{
				"latest",
				"v1",
				"v1.2-fips",
				"v1.2.3-fips",
			},
			oldVersion:     "1.2.3",
			wantTemplate:   "v{major}.{minor}.{patch}-fips",
			wantComponents: 3,
		},
		{
			name: "selects 2 components when patch not available",
			tags: []string{
				"latest",
				"v1",
				"v1.2-fips",
			},
			oldVersion:     "1.2.3",
			wantTemplate:   "v{major}.{minor}-fips",
			wantComponents: 2,
		},
		{
			name: "selects 1 component when only major available",
			tags: []string{
				"latest",
				"v1-fips",
			},
			oldVersion:     "1.2.3",
			wantTemplate:   "v{major}-fips",
			wantComponents: 1,
		},
		{
			name: "returns empty when no valid tags",
			tags: []string{
				"latest",
				"stable",
			},
			oldVersion:     "1.2.3",
			wantTemplate:   "",
			wantComponents: 0,
		},
		{
			name: "prefers patch over minor when both present",
			tags: []string{
				"v1.2",
				"v1.2.3",
			},
			oldVersion:     "1.2.3",
			wantTemplate:   "v{major}.{minor}.{patch}",
			wantComponents: 3,
		},
		{
			name: "skips non-semver tags and selects valid one",
			tags: []string{
				"latest",
				"stable",
				"production",
				"v1.2.3-fips",
			},
			oldVersion:     "1.2.3",
			wantTemplate:   "v{major}.{minor}.{patch}-fips",
			wantComponents: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotTemplate, gotComponents := DeriveTagTemplateFromTags(tt.tags, tt.oldVersion)
			if gotTemplate != tt.wantTemplate {
				t.Errorf("DeriveTagTemplateFromTags() template = %q, want %q", gotTemplate, tt.wantTemplate)
			}
			if gotComponents != tt.wantComponents {
				t.Errorf("DeriveTagTemplateFromTags() components = %d, want %d", gotComponents, tt.wantComponents)
			}
		})
	}
}
