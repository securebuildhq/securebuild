package sbpackage

import (
	"testing"

	apkopackage "chainguard.dev/apko/pkg/apk/apk"
	"github.com/Masterminds/semver"
	"github.com/stretchr/testify/assert"
)

func Test_selectMatchingCandidate(t *testing.T) {
	stringPtr := func(s string) *string {
		return &s
	}

	tests := []struct {
		name       string
		candidates []packageVersionCandidate
		constraint apkopackage.ParsedConstraint
		depName    string
		wantPkgID  string
		wantErr    bool
	}{
		{
			name: "no constraint - returns latest (highest semver)",
			candidates: []packageVersionCandidate{
				{
					PackageID:     "pkg-2",
					VersionID:     "v2",
					Version:       "2.2.0",
					APKRelease:    1,
					ParentID:      nil,
					ParsedVersion: semver.MustParse("2.2.0"),
				},
				{
					PackageID:     "pkg-1",
					VersionID:     "v1",
					Version:       "2.10.0",
					APKRelease:    1,
					ParentID:      nil,
					ParsedVersion: semver.MustParse("2.10.0"),
				},
			},
			constraint: apkopackage.ResolvePackageNameVersionPin("glibc"),
			depName:    "glibc",
			wantPkgID:  "pkg-1",
			wantErr:    false,
		},
		{
			name: "no constraint - returns latest by APK release when semver equal",
			candidates: []packageVersionCandidate{
				{
					PackageID:     "pkg-1",
					VersionID:     "v1",
					Version:       "2.10.0",
					APKRelease:    1,
					ParentID:      nil,
					ParsedVersion: semver.MustParse("2.10.0"),
				},
				{
					PackageID:     "pkg-2",
					VersionID:     "v2",
					Version:       "2.10.0",
					APKRelease:    2,
					ParentID:      nil,
					ParsedVersion: semver.MustParse("2.10.0"),
				},
			},
			constraint: apkopackage.ResolvePackageNameVersionPin("glibc"),
			depName:    "glibc",
			wantPkgID:  "pkg-2", // Higher APK release
			wantErr:    false,
		},
		{
			name: "exact version constraint - returns matching candidate",
			candidates: []packageVersionCandidate{
				{
					PackageID:     "pkg-2",
					VersionID:     "v2",
					Version:       "2.2.0-r1",
					APKRelease:    1,
					ParentID:      nil,
					ParsedVersion: semver.MustParse("2.2.0"),
				},
				{
					PackageID:     "pkg-1",
					VersionID:     "v1",
					Version:       "2.10.0-r1",
					APKRelease:    1,
					ParentID:      nil,
					ParsedVersion: semver.MustParse("2.10.0"),
				},
			},
			constraint: apkopackage.ResolvePackageNameVersionPin("glibc=2.2.0-r1"),
			depName:    "glibc",
			wantPkgID:  "pkg-2",
			wantErr:    false,
		},
		{
			name: "approximate version constraint - returns matching candidate",
			candidates: []packageVersionCandidate{
				{
					PackageID:     "pkg-2",
					VersionID:     "v2",
					Version:       "2.2.0-r1",
					APKRelease:    1,
					ParentID:      nil,
					ParsedVersion: semver.MustParse("2.2.0"),
				},
				{
					PackageID:     "pkg-1",
					VersionID:     "v1",
					Version:       "2.10.0-r1",
					APKRelease:    1,
					ParentID:      nil,
					ParsedVersion: semver.MustParse("2.10.0"),
				},
			},
			constraint: apkopackage.ResolvePackageNameVersionPin("glibc~2.2"),
			depName:    "glibc",
			wantPkgID:  "pkg-2",
			wantErr:    false,
		},
		{
			name: "subpackage - returns parent package ID",
			candidates: []packageVersionCandidate{
				{
					PackageID:     "subpkg-1",
					VersionID:     "v1",
					Version:       "2.10.0-r1",
					APKRelease:    1,
					ParentID:      stringPtr("parent-pkg-1"),
					ParsedVersion: semver.MustParse("2.10.0"),
				},
			},
			constraint: apkopackage.ResolvePackageNameVersionPin("glibc"),
			depName:    "glibc",
			wantPkgID:  "parent-pkg-1",
			wantErr:    false,
		},
		{
			name: "multiple candidates with constraint - returns first matching",
			candidates: []packageVersionCandidate{
				{
					PackageID:     "pkg-3",
					VersionID:     "v3",
					Version:       "2.2.0-r1",
					APKRelease:    1,
					ParentID:      nil,
					ParsedVersion: semver.MustParse("2.2.0"),
				},
				{
					PackageID:     "pkg-1",
					VersionID:     "v1",
					Version:       "3.0.0-r1",
					APKRelease:    1,
					ParentID:      nil,
					ParsedVersion: semver.MustParse("3.0.0"),
				},
				{
					PackageID:     "pkg-2",
					VersionID:     "v2",
					Version:       "2.10.0-r1",
					APKRelease:    1,
					ParentID:      nil,
					ParsedVersion: semver.MustParse("2.10.0"),
				},
			},
			constraint: apkopackage.ResolvePackageNameVersionPin("glibc~2.10"),
			depName:    "glibc",
			wantPkgID:  "pkg-2", // First matching in sorted order (newest first)
			wantErr:    false,
		},
		{
			name:       "empty candidates list - returns error",
			candidates: []packageVersionCandidate{},
			constraint: apkopackage.ResolvePackageNameVersionPin("glibc"),
			depName:    "glibc",
			wantPkgID:  "",
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotPkgID, err := selectMatchingCandidate(tt.candidates, tt.constraint, tt.depName)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			assert.NoError(t, err)
			assert.Equal(t, tt.wantPkgID, gotPkgID)
		})
	}
}

func TestSelectPreferredProvider(t *testing.T) {
	candidates := []providerCandidate{
		{
			CapabilityName:    "go",
			CapabilityVersion: "1.25.9-r1",
			PackageID:         "go-1.25-id",
			PackageName:       "go-1.25",
			PackageVersionID:  "go-1.25-version",
		},
		{
			CapabilityName:    "go",
			CapabilityVersion: "1.26.5-r0",
			PackageID:         "go-1.26-id",
			PackageName:       "go-1.26",
			PackageVersionID:  "go-1.26-version",
		},
	}

	tests := []struct {
		name     string
		selector string
		want     string
		wantErr  bool
	}{
		{name: "unpinned chooses latest provider", selector: "go", want: "go-1.26"},
		{name: "tilde pin chooses latest matching provider", selector: "go~1.25", want: "go-1.25"},
		{name: "upper bound excludes newer provider", selector: "go<1.26", want: "go-1.25"},
		{name: "exact pin chooses matching provider", selector: "go=1.26.5-r0", want: "go-1.26"},
		{name: "unmatched pin returns error", selector: "go~1.24", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			selected, _, err := selectPreferredProvider(candidates, tt.selector)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			assert.NoError(t, err)
			assert.Equal(t, tt.want, selected.PackageName)
		})
	}
}

func TestSelectPreferredProviderTieBreaks(t *testing.T) {
	candidates := []providerCandidate{
		{
			CapabilityName:    "go",
			CapabilityVersion: "1.26.5-r0",
			PackageID:         "virtual-id",
			PackageName:       "go-virtual-provider",
			PackageVersionID:  "virtual-version",
		},
		{
			CapabilityName:    "go",
			CapabilityVersion: "1.26.5-r0",
			PackageID:         "exact-id",
			PackageName:       "go",
			PackageVersionID:  "exact-version",
			ExactName:         true,
		},
	}

	selected, ambiguous, err := selectPreferredProvider(candidates, "go")
	assert.NoError(t, err)
	assert.False(t, ambiguous)
	assert.Equal(t, "go", selected.PackageName)
}
