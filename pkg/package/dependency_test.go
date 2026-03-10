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
