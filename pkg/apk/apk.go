package apk

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

type APKIndex struct {
	Packages []map[string]string
}

func RemoveAPKFromIndex(ctx context.Context, pkgName string, pkgVersion string, pkgRel string, pathToIndexTarGz string) (string, error) {
	var apkIndex *APKIndex
	var err error
	if pathToIndexTarGz == "" {
		apkIndex = &APKIndex{Packages: []map[string]string{}}
	} else {
		apkIndex, err = ExtractAPKIndex(pathToIndexTarGz)
		if err != nil {
			return "", fmt.Errorf("failed to extract APK index from '%s': %w", pathToIndexTarGz, err)
		}
	}

	packageVersionJoined := fmt.Sprintf("%s-%s", pkgVersion, pkgRel)

	for i, pkg := range apkIndex.Packages {
		if pkg["P"] == pkgName {
			if pkg["V"] == packageVersionJoined {
				logger.Debug("removing package from index", zap.String("pkg", pkg["P"]), zap.String("pkg_version", pkg["V"]))
				apkIndex.Packages = append(apkIndex.Packages[:i], apkIndex.Packages[i+1:]...)
				break
			}
		}
	}

	// write the index back to a new file
	newIndexFile, err := os.CreateTemp("", "apk-index-*.tar.gz")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file for new APK index: %w", err)
	}
	newIndexFile.Close() // Close the file handle since we only need the path
	pathToIndexTarGz = newIndexFile.Name()

	if err := writeAPKIndex(pathToIndexTarGz, apkIndex); err != nil {
		return "", fmt.Errorf("failed to write APK index to '%s': %w", pathToIndexTarGz, err)
	}

	return pathToIndexTarGz, nil
}

func AddAPKToIndex(ctx context.Context, apkMeta map[string]string, pathToIndexTarGz string) (string, error) {
	// Convert verbose PKGINFO field names to single-letter APKINDEX format
	indexMeta := make(map[string]string)
	if v, ok := apkMeta["pkgname"]; ok {
		indexMeta["P"] = v
	}
	if v, ok := apkMeta["pkgver"]; ok {
		indexMeta["V"] = v
	}
	if v, ok := apkMeta["pkgrel"]; ok {
		indexMeta["r"] = v
	}
	if v, ok := apkMeta["pkgdesc"]; ok {
		indexMeta["T"] = v
	}
	if v, ok := apkMeta["url"]; ok {
		indexMeta["U"] = v
	}
	if v, ok := apkMeta["size"]; ok {
		indexMeta["S"] = v
	}
	if v, ok := apkMeta["installed_size"]; ok {
		indexMeta["I"] = v
	}
	if v, ok := apkMeta["arch"]; ok {
		indexMeta["A"] = v
	}
	if v, ok := apkMeta["license"]; ok {
		indexMeta["L"] = v
	}
	if v, ok := apkMeta["maintainer"]; ok {
		indexMeta["m"] = v
	}
	if v, ok := apkMeta["origin"]; ok {
		indexMeta["o"] = v
	}
	if v, ok := apkMeta["depend"]; ok {
		indexMeta["D"] = v
	}
	if v, ok := apkMeta["provides"]; ok {
		indexMeta["p"] = v
	}
	if v, ok := apkMeta["sha1"]; ok {
		indexMeta["c"] = v
	}
	if v, ok := apkMeta["alpine_checksum"]; ok {
		indexMeta["C"] = v
	}
	if v, ok := apkMeta["installed_size"]; ok {
		indexMeta["I"] = v
	}

	var apkIndex *APKIndex
	var err error
	if pathToIndexTarGz == "" {
		apkIndex = &APKIndex{Packages: []map[string]string{}}
	} else {
		apkIndex, err = ExtractAPKIndex(pathToIndexTarGz)
		if err != nil {
			return "", fmt.Errorf("failed to extract APK index from '%s': %w", pathToIndexTarGz, err)
		}
	}

	name := apkMeta["pkgname"]
	newVersionStr := fmt.Sprintf("%s-r%s", apkMeta["pkgver"], apkMeta["pkgrel"])

	filtered := make([]map[string]string, 0, len(apkIndex.Packages))
	for _, pkg := range apkIndex.Packages {
		if pkg["P"] == name {
			// The V field in APKINDEX might already include -rX suffix
			existingVersionStr := pkg["V"]
			if !strings.Contains(existingVersionStr, "-r") {
				// If no release suffix, check if there's a separate r field
				if rel, ok := pkg["r"]; ok && rel != "" {
					existingVersionStr = fmt.Sprintf("%s-r%s", existingVersionStr, rel)
				} else {
					existingVersionStr = fmt.Sprintf("%s-r0", existingVersionStr)
				}
			}

			if existingVersionStr == newVersionStr {
				// Replace the existing entry. A retry can publish a different
				// artifact at the same name/version, so retaining its old checksum
				// would make APKINDEX disagree with the canonical APK object.
				continue
			}
		}
		filtered = append(filtered, pkg)
	}

	apkIndex.Packages = append(filtered, indexMeta)

	if pathToIndexTarGz == "" {
		newIndexFile, err := os.CreateTemp("", "apk-index-*.tar.gz")
		if err != nil {
			return "", fmt.Errorf("failed to create temp file for new APK index: %w", err)
		}
		newIndexFile.Close() // Close the file handle since we only need the path
		pathToIndexTarGz = newIndexFile.Name()
	}

	// Always write as unsigned index first
	if err := writeAPKIndex(pathToIndexTarGz, apkIndex); err != nil {
		return "", fmt.Errorf("failed to write APK index to '%s': %w", pathToIndexTarGz, err)
	}

	return pathToIndexTarGz, nil
}

func ValidateAPK(pathToAPK string) error {
	if pathToAPK == "" {
		return fmt.Errorf("APK path is empty")
	}

	fInfo, err := os.Stat(pathToAPK)
	if err != nil {
		return fmt.Errorf("failed to stat APK file '%s': %w", pathToAPK, err)
	}
	if fInfo.Size() == 0 {
		return fmt.Errorf("APK file '%s' is empty", pathToAPK)
	}

	// Extract APK metadata - this validates the entire file structure
	// If this succeeds, we know the file:
	// 1. Has valid gzip streams
	// 2. Contains .PKGINFO in control stream
	// 3. Is a properly formatted APK
	// No need for additional validation beyond this
	_, err = ExtractAPKMetadata(pathToAPK)
	if err != nil {
		return fmt.Errorf("invalid APK metadata in '%s': %w", pathToAPK, err)
	}

	// If metadata extraction succeeded, the APK is valid
	return nil
}

type Version struct {
	Base    string
	Release int
}

func parseVersion(versionStr string) (Version, error) {
	parts := strings.Split(versionStr, "-r")
	if len(parts) != 2 {
		// Fallback for versions without -r suffix
		return Version{Base: versionStr, Release: 0}, nil
	}

	base := parts[0]
	release, err := strconv.Atoi(parts[1])
	if err != nil {
		return Version{}, fmt.Errorf("invalid release number in version '%s'", versionStr)
	}

	return Version{Base: base, Release: release}, nil
}

func (v Version) GreaterThanOrEqual(other Version) bool {
	if v.Base > other.Base {
		return true
	}
	if v.Base < other.Base {
		return false
	}
	// Bases are equal, compare by release number
	return v.Release >= other.Release
}
