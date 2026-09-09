package security

import (
	"crypto/sha256"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/anchore/syft/syft/artifact"
	"github.com/anchore/syft/syft/file"
	"github.com/anchore/syft/syft/format/syftjson"
	"github.com/anchore/syft/syft/pkg"
	"github.com/stretchr/testify/require"
)

const grpcName = "google.golang.org/grpc"
const grpcCVE = "CVE-2026-84304"

// These reduced fixtures preserve the APK, main-module build info, binary file
// metadata and ownership edge from the published SDK 1.19.11 image. Unrelated
// packages and dependencies are omitted; their presence is not a prerequisite.
func removalScans(t *testing.T) ([]PackageFixScan, pkg.Package) {
	t.Helper()
	var scans []PackageFixScan
	var target pkg.Package
	for i, arch := range []string{"amd64", "arm64"} {
		raw, err := os.ReadFile("test-data/removed-go-dependency-" + arch + ".json")
		require.NoError(t, err)
		s, _, _, err := syftjson.NewFormatDecoder().Decode(strings.NewReader(string(raw)))
		require.NoError(t, err)
		scans = append(scans, PackageFixScan{Architecture: []string{"x86_64", "aarch64"}[i], SBOM: s, SHA256: fmt.Sprintf("%x", sha256.Sum256(raw))})
		for p := range s.Artifacts.Packages.Enumerate() {
			if p.Type == pkg.ApkPkg {
				target = p
			}
		}
	}
	return scans, target
}

func addDependency(scan *PackageFixScan, name, v string, owned bool) {
	var owner, dep pkg.Package
	for _, p := range scan.SBOM.Artifacts.Packages.Sorted() {
		if p.Type == pkg.ApkPkg {
			owner = p
		}
		if p.Type == pkg.GoModulePkg {
			dep = p
		}
	}
	dep.Name = name
	dep.Version = v
	dep.SetID()
	scan.SBOM.Artifacts.Packages.Add(dep)
	if owned {
		scan.SBOM.Relationships = append(scan.SBOM.Relationships, artifact.Relationship{From: owner, To: dep, Type: artifact.OwnershipByFileOverlapRelationship})
	}
}

func replacePackage(scan *PackageFixScan, kind pkg.Type, mutate func(*pkg.Package)) {
	for _, p := range scan.SBOM.Artifacts.Packages.Sorted() {
		if p.Type != kind {
			continue
		}
		id := p.ID()
		mutate(&p)
		scan.SBOM.Artifacts.Packages.Delete(id)
		scan.SBOM.Artifacts.Packages.Add(p)
		for i, rel := range scan.SBOM.Relationships {
			if rel.From != nil && rel.From.ID() == id {
				scan.SBOM.Relationships[i].From = p
			}
			if rel.To != nil && rel.To.ID() == id {
				scan.SBOM.Relationships[i].To = p
			}
		}
	}
}

func TestPackageFixEvidence(t *testing.T) {
	tests := []struct {
		name   string
		mutate func([]PackageFixScan)
		fixes  []string
		want   string
	}{
		{name: "removed from both architectures", fixes: []string{"1.83.1"}, want: fixRemoved},
		{name: "removed even without upstream fix", want: fixRemoved},
		{name: "remaining vulnerable on ARM", mutate: func(s []PackageFixScan) { addDependency(&s[1], grpcName, "1.83.0", true) }, fixes: []string{"1.83.1"}, want: fixAffected},
		{name: "removed on x86 upgraded on ARM", mutate: func(s []PackageFixScan) { addDependency(&s[1], grpcName, "1.83.1", true) }, fixes: []string{"1.83.1"}, want: fixRemoved},
		{name: "upgraded on both", mutate: func(s []PackageFixScan) {
			for i := range s {
				addDependency(&s[i], grpcName, "1.83.1", true)
			}
		}, fixes: []string{"1.83.1"}, want: fixUpgraded},
		{name: "multiple versions one vulnerable", mutate: func(s []PackageFixScan) {
			for i := range s {
				addDependency(&s[i], grpcName, "1.83.0", true)
				addDependency(&s[i], grpcName, "1.83.1", true)
			}
		}, fixes: []string{"1.83.1"}, want: fixAffected},
		{name: "unparseable present version", mutate: func(s []PackageFixScan) { addDependency(&s[1], grpcName, "invalid", true) }, fixes: []string{"1.83.1"}},
		{name: "present dependency without fix", mutate: func(s []PackageFixScan) { addDependency(&s[1], grpcName, "1.83.0", true) }},
		{name: "scan match without known fix", mutate: func(s []PackageFixScan) {
			addDependency(&s[1], grpcName, "1.83.0", true)
			s[1].Vulnerabilities = []CVEPackageFix{{CVEID: grpcCVE, ArtifactName: grpcName, ArtifactType: "go-module", ArtifactVersion: "1.83.0"}}
		}, want: fixAffected},
		{name: "scan contradicts declared fixed version", mutate: func(s []PackageFixScan) {
			addDependency(&s[1], grpcName, "1.83.1", true)
			s[1].Vulnerabilities = []CVEPackageFix{{CVEID: grpcCVE, ArtifactName: grpcName, ArtifactType: "go-module", ArtifactVersion: "1.83.1"}}
		}, fixes: []string{"1.83.1"}, want: fixAffected},
		{name: "lost dependency ownership", mutate: func(s []PackageFixScan) { addDependency(&s[1], grpcName, "1.83.0", false) }, fixes: []string{"1.83.1"}},
		{name: "lost all ownership", mutate: func(s []PackageFixScan) { s[1].SBOM.Relationships = nil }, fixes: []string{"1.83.1"}},
		{name: "no executable catalog", mutate: func(s []PackageFixScan) { s[1].SBOM.Artifacts.Executables = nil }, fixes: []string{"1.83.1"}},
		{name: "no file metadata", mutate: func(s []PackageFixScan) { s[1].SBOM.Artifacts.FileMetadata = nil }, fixes: []string{"1.83.1"}},
		{name: "source-only Go catalog", mutate: func(s []PackageFixScan) {
			replacePackage(&s[1], pkg.GoModulePkg, func(p *pkg.Package) { p.Metadata = nil })
		}, fixes: []string{"1.83.1"}},
		{name: "wrong binary architecture", mutate: func(s []PackageFixScan) {
			replacePackage(&s[1], pkg.GoModulePkg, func(p *pkg.Package) {
				info := p.Metadata.(pkg.GolangBinaryBuildinfoEntry)
				info.Architecture = "amd64"
				p.Metadata = info
			})
		}, fixes: []string{"1.83.1"}},
		{name: "second unscanned binary", mutate: func(s []PackageFixScan) {
			for _, p := range s[1].SBOM.Artifacts.Packages.Sorted() {
				if p.Type == pkg.ApkPkg {
					apk := p.Metadata.(pkg.ApkDBEntry)
					apk.Files = append(apk.Files, pkg.ApkFileRecord{Path: "/usr/bin/other", Permissions: "0755", Digest: &file.Digest{Algorithm: "sha256", Value: "123"}})
					p.Metadata = apk
					s[1].SBOM.Artifacts.Packages.Delete(p.ID())
					s[1].SBOM.Artifacts.Packages.Add(p)
				}
			}
		}, fixes: []string{"1.83.1"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scans, target := removalScans(t)
			if tt.mutate != nil {
				tt.mutate(scans)
			}
			inv, err := packageInventories(scans, target)
			require.NoError(t, err)
			require.Equal(t, tt.want, evaluatePackageFix(inv, grpcCVE, grpcName, "go-module", tt.fixes))
		})
	}
}

func TestPackageFixRequiresArchitectureCoverage(t *testing.T) {
	for _, kind := range []string{"missing", "duplicate", "nil", "digest", "wrong version", "wrong arch"} {
		t.Run(kind, func(t *testing.T) {
			scans, target := removalScans(t)
			switch kind {
			case "missing":
				scans = scans[:1]
			case "duplicate":
				scans[1] = scans[0]
			case "nil":
				scans[1].SBOM = nil
			case "digest":
				scans[1].SHA256 = ""
			case "wrong version":
				target.Version = "1.19.12-r0"
			case "wrong arch":
				replacePackage(&scans[1], pkg.ApkPkg, func(p *pkg.Package) {
					apk := p.Metadata.(pkg.ApkDBEntry)
					apk.Architecture = "x86_64"
					p.Metadata = apk
				})
			}
			_, err := packageInventories(scans, target)
			require.Error(t, err)
		})
	}
}

func TestRemovalDoesNotResolveOtherArtifactTypes(t *testing.T) {
	scans, target := removalScans(t)
	inv, err := packageInventories(scans, target)
	require.NoError(t, err)
	for _, kind := range []string{"apk", "npm", "python"} {
		require.Empty(t, evaluatePackageFix(inv, "CVE-test", "missing", kind, []string{"1.0.0"}))
	}
}

func TestPackageFixRegression(t *testing.T) {
	evidence := map[string]packageFixEvidence{"1.19.11-r0": {Reason: fixRemoved}}
	versions, err := mergePackageFixVersions(nil, "1.19.11-r0", evidence)
	require.NoError(t, err)
	require.Equal(t, []string{"1.19.11-r0"}, versions)
	evidence["1.19.12-r0"] = packageFixEvidence{Reason: fixAffected}
	versions, err = mergePackageFixVersions(versions, "1.19.12-r0", evidence)
	require.NoError(t, err)
	require.Empty(t, versions)
	// Older builds finishing later must not restore the now-unsafe bound.
	versions, err = mergePackageFixVersions(versions, "1.19.11-r0", evidence)
	require.NoError(t, err)
	require.Empty(t, versions)
	evidence["1.19.12-r1"] = packageFixEvidence{Reason: fixUpgraded}
	versions, err = mergePackageFixVersions(versions, "1.19.12-r1", evidence)
	require.NoError(t, err)
	require.Equal(t, []string{"1.19.12-r1"}, versions)
}
