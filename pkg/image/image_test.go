package image

import (
	"context"
	"testing"
)

func TestAlternateImageExists(t *testing.T) {
	tests := []struct {
		name        string
		registryURL string
		want        bool
		wantErr     bool
	}{
		{
			name:        "postgres:latest",
			registryURL: "postgres:latest",
			want:        true,
			wantErr:     false,
		},
		{
			name:        "schemahero:latest",
			registryURL: "schemahero:latest",
			want:        false,
			wantErr:     false,
		},
		{
			name:        "postgres:latest-dev",
			registryURL: "postgres:latest-dev",
			want:        false,
			wantErr:     false,
		},
		{
			name:        "ghcr",
			registryURL: "ghcr.io/not-an-image/still-not:1234",
			want:        false,
			wantErr:     false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := AlternateImageExists(context.TODO(), tt.registryURL)
			if (err != nil) != tt.wantErr {
				t.Errorf("AlternateImageExists() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("AlternateImageExists() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsPackageCoreForAPKOWithNames(t *testing.T) {
	tests := []struct {
		name          string
		apkoYAML      string
		apkoTags      []string
		possibleNames map[string]struct{}
		oldVersion    string
		expected      bool
		wantErr       bool
	}{
		{
			name:          "core package - exact APK pin includes release",
			apkoYAML:      "contents:\n  packages:\n    - rook-1.19=1.19.7-r0\n",
			apkoTags:      []string{"v1.19.7"},
			possibleNames: map[string]struct{}{"rook-1.19": {}},
			oldVersion:    "1.19.7",
			expected:      true,
		},
		{
			name: "core package - pinned with matching tag",
			apkoYAML: `contents:
  packages:
    - bash-5.2~5.2.37
    - bash-entrypoint-5.2~5.2.37
    - ca-certificates-bundle
    - busybox`,
			apkoTags: []string{"5.2.37", "latest"},
			possibleNames: map[string]struct{}{
				"bash-5.2":            {},
				"bash":                {},
				"bash-entrypoint-5.2": {},
			},
			oldVersion: "5.2.37",
			expected:   true,
			wantErr:    false,
		},
		{
			name: "core package - pinned with matching tag with v prefix",
			apkoYAML: `contents:
  packages:
    - bash-5.2~5.2.37
    - ca-certificates-bundle`,
			apkoTags: []string{"v5.2.37", "latest"},
			possibleNames: map[string]struct{}{
				"bash-5.2": {},
				"bash":     {},
			},
			oldVersion: "5.2.37",
			expected:   true,
			wantErr:    false,
		},
		{
			name: "not core - package not pinned",
			apkoYAML: `contents:
  packages:
    - bash-5.2~5.2.37
    - ca-certificates-bundle
    - busybox`,
			apkoTags: []string{"5.2.37", "latest"},
			possibleNames: map[string]struct{}{
				"ca-certificates-bundle": {},
			},
			oldVersion: "1.0.0",
			expected:   false,
			wantErr:    false,
		},
		{
			name: "not core - no matching tag",
			apkoYAML: `contents:
  packages:
    - bash-5.2~5.2.37
    - ca-certificates-bundle`,
			apkoTags: []string{"5.2.36", "latest"},
			possibleNames: map[string]struct{}{
				"bash-5.2": {},
				"bash":     {},
			},
			oldVersion: "5.2.37",
			expected:   false,
			wantErr:    false,
		},
		{
			name: "not core - wrong version pin",
			apkoYAML: `contents:
  packages:
    - bash-5.2~5.2.36
    - ca-certificates-bundle`,
			apkoTags: []string{"5.2.37", "latest"},
			possibleNames: map[string]struct{}{
				"bash-5.2": {},
				"bash":     {},
			},
			oldVersion: "5.2.37",
			expected:   false,
			wantErr:    false,
		},
		{
			name: "not core - package name mismatch",
			apkoYAML: `contents:
  packages:
    - bash-5.2~5.2.37
    - git-5.2~5.2.15`,
			apkoTags: []string{"5.2.37", "latest"},
			possibleNames: map[string]struct{}{
				"git-5.2": {},
				"git":     {},
			},
			oldVersion: "5.2.37",
			expected:   false,
			wantErr:    false,
		},
		{
			name: "core package - multiple packages with same pin",
			apkoYAML: `contents:
  packages:
    - bash-5.2~5.2.37
    - bash-entrypoint-5.2~5.2.37
    - git-5.2~5.2.15`,
			apkoTags: []string{"5.2.15", "latest"},
			possibleNames: map[string]struct{}{
				"git-5.2": {},
				"git":     {},
			},
			oldVersion: "5.2.15",
			expected:   true,
			wantErr:    false,
		},
		{
			name:     "invalid YAML",
			apkoYAML: `this is not valid yaml: {{{`,
			apkoTags: []string{"5.2.37"},
			possibleNames: map[string]struct{}{
				"bash-5.2": {},
				"bash":     {},
			},
			oldVersion: "5.2.37",
			expected:   false,
			wantErr:    true,
		},
		{
			name: "core package - matches on provides name",
			apkoYAML: `contents:
  packages:
    - kotsadm~1.127.1`,
			apkoTags: []string{"1.127.1"},
			possibleNames: map[string]struct{}{
				"kotsadm-1.127": {},
				"kotsadm":       {},
			},
			oldVersion: "1.127.1",
			expected:   true,
			wantErr:    false,
		},
		{
			name: "core package - matches on subpackage provides name",
			apkoYAML: `contents:
  packages:
    - kotsadm-migrations~1.127.1`,
			apkoTags: []string{"1.127.1"},
			possibleNames: map[string]struct{}{
				"kotsadm-1.127-migrations": {},
				"kotsadm-migrations":       {},
			},
			oldVersion: "1.127.1",
			expected:   true,
			wantErr:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := isPackageCoreForAPKOWithNames(tt.apkoYAML, tt.apkoTags, tt.possibleNames, tt.oldVersion)

			if tt.wantErr {
				if err == nil {
					t.Errorf("isPackageCoreForAPKOWithNames() expected error but got none")
				}
				return
			}

			if err != nil {
				t.Errorf("isPackageCoreForAPKOWithNames() unexpected error: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("isPackageCoreForAPKOWithNames() = %v; want %v", result, tt.expected)
			}
		})
	}
}

func TestCorePackageVersionForAPKOWithNames(t *testing.T) {
	names := map[string]struct{}{"rook": {}, "rook-1.19": {}, "rook-1.19-compat": {}, "csi-provisioner-6.1": {}}
	for _, tc := range []struct {
		name, pin, sourceVersion, want string
		tags                           []string
	}{
		{"exact release pin", "rook-1.19=1.19.7-r12", "1.19.7", "1.19.7", []string{"v1.19.7"}},
		{"image lags source package", "rook-1.19~1.19.7", "1.19.11", "1.19.7", []string{"v1.19.7"}},
		{"CSI template lags source package", "csi-provisioner-6.1~6.1.1", "6.1.3", "6.1.1", []string{"v6.1.1"}},
		{"subpackage is image core", "rook-1.19-compat=1.19.7-r2", "1.19.11", "1.19.7", []string{"v1.19.7"}},
		{"minor alias tag", "rook-1.19~1.19.7", "1.19.11", "1.19.7", []string{"v1.19", "latest"}},
		{"unrelated dependency", "ceph-19.2=19.2.4-r3", "1.19.11", "", []string{"v19.2.4"}},
		{"pin and tag disagree", "rook-1.19=1.19.7-r0", "1.19.11", "", []string{"v1.19.8"}},
		{"different source line", "rook=1.18.7-r0", "1.19.11", "", []string{"v1.18.7"}},
		{"unversioned package", "rook-1.19", "1.19.11", "", []string{"v1.19.11"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := corePackageVersionForAPKOWithNames("contents:\n  packages:\n    - "+tc.pin+"\n", tc.tags, names, tc.sourceVersion)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("got core version %q, want %q", got, tc.want)
			}
		})
	}
}
