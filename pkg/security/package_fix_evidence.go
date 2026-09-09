package security

import (
	"fmt"
	"path"
	"time"

	"github.com/Masterminds/semver/v3"
	"github.com/anchore/grype/grype/version"
	"github.com/anchore/syft/syft/artifact"
	"github.com/anchore/syft/syft/file"
	"github.com/anchore/syft/syft/pkg"
	"github.com/anchore/syft/syft/sbom"
)

const (
	fixRemoved  = "dependency_removed"
	fixUpgraded = "dependency_upgraded"
	fixAffected = "affected"
)

// PackageFixScan is a successfully generated, unfiltered image SBOM. SHA256 is
// the digest of its original JSON, retained with the originating image build.
// Both x86_64 and aarch64 are required because secdb has no architecture scope.
type PackageFixScan struct {
	Architecture    string
	SBOM            *sbom.SBOM
	SHA256          string
	Vulnerabilities []CVEPackageFix
}

type packageFixEvidence struct {
	Reason     string            `json:"reason"`
	Source     string            `json:"source"`
	SBOMSHA256 map[string]string `json:"sbom_sha256"`
	ObservedAt time.Time         `json:"observed_at"`
}

type artifactKey struct {
	name string
	kind pkg.Type
}
type packageInventory struct {
	artifacts       map[artifactKey][]pkg.Package
	completeGo      bool
	vulnerabilities map[artifactKey]map[string]bool
}

func packageInventories(scans []PackageFixScan, target pkg.Package) ([]packageInventory, error) {
	if target.Type != pkg.ApkPkg || target.Name == "" || target.Version == "" {
		return nil, fmt.Errorf("expected a versioned APK package")
	}
	if len(scans) != 2 {
		return nil, fmt.Errorf("both x86_64 and aarch64 SBOMs are required")
	}
	seen := map[string]bool{}
	var inventories []packageInventory
	for _, scan := range scans {
		if (scan.Architecture != "x86_64" && scan.Architecture != "aarch64") || seen[scan.Architecture] {
			return nil, fmt.Errorf("invalid or duplicate architecture %q", scan.Architecture)
		}
		seen[scan.Architecture] = true
		if scan.SBOM == nil || scan.SBOM.Artifacts.Packages == nil || len(scan.SHA256) != 64 {
			return nil, fmt.Errorf("missing SBOM or digest for %s", scan.Architecture)
		}
		var owner *pkg.Package
		for _, p := range scan.SBOM.Artifacts.Packages.Sorted() {
			if p.Type == pkg.ApkPkg && p.Name == target.Name {
				if owner != nil || p.Version != target.Version {
					return nil, fmt.Errorf("ambiguous package version for %s on %s", target.Name, scan.Architecture)
				}
				copy := p
				owner = &copy
			}
		}
		if owner == nil {
			return nil, fmt.Errorf("package %s missing on %s", target.Name, scan.Architecture)
		}
		apk, ok := owner.Metadata.(pkg.ApkDBEntry)
		if !ok || (apk.Architecture != scan.Architecture && apk.Architecture != "noarch") {
			return nil, fmt.Errorf("missing or mismatched APK architecture for %s", target.Name)
		}
		inv := packageInventory{artifacts: map[artifactKey][]pkg.Package{}, vulnerabilities: map[artifactKey]map[string]bool{}}
		inv.artifacts[artifactKey{owner.Name, owner.Type}] = []pkg.Package{*owner}
		for _, rel := range scan.SBOM.RelationshipsForPackage(*owner, artifact.OwnershipByFileOverlapRelationship) {
			if rel.From != nil && rel.From.ID() == owner.ID() {
				if child, ok := rel.To.(pkg.Package); ok {
					key := artifactKey{child.Name, child.Type}
					inv.artifacts[key] = append(inv.artifacts[key], child)
				}
			}
		}
		inv.completeGo = completeGoBinaryInventory(scan, apk, inv)
		for _, match := range scan.Vulnerabilities {
			key := artifactKey{match.ArtifactName, pkg.Type(match.ArtifactType)}
			for _, entry := range inv.artifacts[key] {
				if entry.Version == match.ArtifactVersion {
					if inv.vulnerabilities[key] == nil {
						inv.vulnerabilities[key] = map[string]bool{}
					}
					inv.vulnerabilities[key][match.CVEID] = true
				}
			}
		}
		inventories = append(inventories, inv)
	}
	return inventories, nil
}

// Require actual Go binary build-info (not go.mod/go.sum), APK file ownership,
// file metadata, and executable classification. Every owned executable must have
// been cataloged; one successfully scanned binary cannot cover a second unreadable
// binary. Mixed-language/native executable packages are deliberately left unresolved.
func completeGoBinaryInventory(scan PackageFixScan, apk pkg.ApkDBEntry, inv packageInventory) bool {
	goPaths := map[string]bool{}
	ownedIDs := map[artifact.ID]bool{}
	ownedPaths := map[string]bool{}
	for _, f := range apk.Files {
		ownedPaths[path.Clean("/"+f.Path)] = true
	}
	expectedArch := map[string]string{"x86_64": "amd64", "aarch64": "arm64"}[scan.Architecture]
	for key, artifacts := range inv.artifacts {
		if key.kind != pkg.GoModulePkg {
			continue
		}
		for _, p := range artifacts {
			ownedIDs[p.ID()] = true
			info, ok := p.Metadata.(pkg.GolangBinaryBuildinfoEntry)
			if !ok || info.GoCompiledVersion == "" || info.MainModule != p.Name || info.Architecture != expectedArch {
				continue
			}
			for _, loc := range p.Locations.ToSlice() {
				goPaths[path.Clean(loc.RealPath)] = true
			}
		}
	}
	if len(goPaths) == 0 {
		return false
	}
	// A lost ownership edge must not make a still-present dependency look removed.
	for _, p := range scan.SBOM.Artifacts.Packages.Sorted() {
		if p.Type != pkg.GoModulePkg || ownedIDs[p.ID()] {
			continue
		}
		for _, loc := range p.Locations.ToSlice() {
			if ownedPaths[path.Clean(loc.RealPath)] {
				return false
			}
		}
	}
	metadata := map[string]file.Metadata{}
	executables := map[string]file.Executable{}
	for c, m := range scan.SBOM.Artifacts.FileMetadata {
		metadata[path.Clean(c.RealPath)] = m
	}
	for c, e := range scan.SBOM.Artifacts.Executables {
		executables[path.Clean(c.RealPath)] = e
	}
	foundBinary := false
	for _, f := range apk.Files {
		// APK directory entries have no digest. Files do, including non-executable data.
		if f.Digest == nil && f.Permissions == "" {
			continue
		}
		p := path.Clean("/" + f.Path)
		m, ok := metadata[p]
		if !ok || m.FileInfo == nil {
			return false
		}
		exe, isBinary := executables[p]
		if isBinary || m.Mode().Perm()&0111 != 0 {
			if !isBinary || exe.Format != file.ELF || !goPaths[p] {
				return false
			}
			foundBinary = true
		}
	}
	return foundBinary
}

// An empty result means insufficient evidence; it must never create a fix claim.
func evaluatePackageFix(inventories []packageInventory, cve, name, artifactType string, fixes []string) string {
	removed := false
	unknown := false
	for _, inv := range inventories {
		if inv.vulnerabilities[artifactKey{name, pkg.Type(artifactType)}][cve] {
			return fixAffected
		}
		entries := inv.artifacts[artifactKey{name, pkg.Type(artifactType)}]
		if len(entries) == 0 {
			if artifactType == string(pkg.GoModulePkg) && inv.completeGo {
				removed = true
			} else {
				unknown = true
			}
			continue
		}
		// Check every copy/version, not an arbitrary map winner.
		for _, entry := range entries {
			if artifactType == string(pkg.GoModulePkg) {
				if _, err := semver.NewVersion(entry.Version); err != nil {
					unknown = true
					continue
				}
			}
			if len(fixes) == 0 {
				unknown = true
				continue
			}
			fixed, err := ArtifactVersionSatisfiesAnyFix(entry.Version, fixes, artifactType)
			if err != nil {
				unknown = true
				continue
			}
			if !fixed {
				return fixAffected
			}
		}
		if artifactType == string(pkg.GoModulePkg) && !inv.completeGo {
			unknown = true
		}
	}
	if unknown || len(inventories) != 2 {
		return ""
	}
	if removed {
		return fixRemoved
	}
	return fixUpgraded
}

// Alpine secdb cannot describe a vulnerable interval after a fix. Conservatively
// withdraw all fix claims at/before any observed affected release. Keep the
// observations so rebuilding an older release cannot reinstate a withdrawn claim.
func mergePackageFixVersions(current []string, observed string, evidence map[string]packageFixEvidence) ([]string, error) {
	candidates := append([]string{}, current...)
	if evidence[observed].Reason != fixAffected {
		candidates = append(candidates, observed)
	}
	safe := []string{}
	for _, candidate := range candidates {
		keep := true
		for affected, record := range evidence {
			if record.Reason != fixAffected {
				continue
			}
			cmp, err := version.New(candidate, version.ApkFormat).Compare(version.New(affected, version.ApkFormat))
			if err != nil {
				return nil, fmt.Errorf("compare package fix versions: %w", err)
			}
			if cmp <= 0 {
				keep = false
				break
			}
		}
		if keep {
			safe = append(safe, candidate)
		}
	}
	if len(safe) == 0 {
		return safe, nil
	}
	return deduplicateVersionsByPrefix(safe[:len(safe)-1], safe[len(safe)-1]), nil
}
