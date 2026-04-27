package apk

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"strings"
)

func ExtractAPKMetadata(apkPath string) (map[string]string, error) {
	pkgInfoContent, err := extractPKGINFOFromAPK(apkPath)
	if err != nil {
		return nil, err
	}

	metadata, err := parsePKGINFO(pkgInfoContent)
	if err != nil {
		return nil, err
	}

	c, err := sha1HexOfFile(apkPath)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate SHA1 of APK file '%s': %w", apkPath, err)
	}
	metadata["sha1"] = c

	C, err := generateAlpineChecksum(apkPath)
	if err != nil {
		return nil, fmt.Errorf("failed to generate Alpine checksum for APK file '%s': %w", apkPath, err)
	}
	metadata["alpine_checksum"] = C

	installedSize, err := calculateInstalledSize(apkPath)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate installed size for APK file '%s': %w", apkPath, err)
	}
	metadata["installed_size"] = fmt.Sprintf("%d", installedSize)

	return metadata, nil
}

// ExtractAPKMetadataOptimized extracts all APK metadata with minimal memory usage
// by loading the file only once and processing all streams in a single pass
func ExtractAPKMetadataOptimized(apkPath string) (map[string]string, error) {
	// Load file once into memory
	file, err := os.Open(apkPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open APK file: %w", err)
	}
	defer file.Close()

	apkData, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read APK file: %w", err)
	}

	// Extract all metadata in single pass
	pkgInfoContent, controlStream, installedSize, err := extractAllMetadataFromAPKData(apkData)
	if err != nil {
		return nil, err
	}

	// Parse PKGINFO content
	metadata, err := parsePKGINFO(pkgInfoContent)
	if err != nil {
		return nil, err
	}

	// Calculate SHA1 of entire file (streaming - efficient)
	sha1Hash, err := sha1HexOfFile(apkPath)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate SHA1 of APK file: %w", err)
	}
	metadata["sha1"] = sha1Hash

	// Calculate Alpine checksum from control stream
	alpineChecksum := calculateAlpineChecksumFromStream(controlStream)
	metadata["alpine_checksum"] = alpineChecksum

	// Set installed size
	metadata["installed_size"] = fmt.Sprintf("%d", installedSize)

	return metadata, nil
}

// extractAllMetadataFromAPKData walks the APK's gzip members (signature,
// control, data) in order and pulls out the .PKGINFO bytes, the raw control
// stream (used for the APKINDEX C: checksum), and the installed size.
//
// It uses extractAPKStreams rather than scanning for 1f 8b magic bytes, because
// those magic bytes can legitimately appear inside deflate output and truncate
// a stream into a shorter-but-still-valid-looking slice — which is how the
// APKINDEX control-hash drift bug entered the catalog.
func extractAllMetadataFromAPKData(apkData []byte) (pkgInfoContent []byte, controlStream []byte, installedSize int64, err error) {
	streams, err := extractAPKStreams(apkData)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("extract gzip streams: %w", err)
	}

	for _, streamData := range streams {
		gzipReader, err := gzip.NewReader(bytes.NewReader(streamData))
		if err != nil {
			continue
		}

		tarReader := tar.NewReader(gzipReader)
		streamContainsPKGINFO := false
		streamContainsFiles := false
		var streamInstalledSize int64

		for {
			header, err := tarReader.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				break
			}

			if header.Name == ".PKGINFO" && pkgInfoContent == nil {
				content, readErr := io.ReadAll(tarReader)
				if readErr == nil {
					pkgInfoContent = content
					streamContainsPKGINFO = true
				}
			} else if header.Typeflag == tar.TypeReg &&
				!strings.HasPrefix(header.Name, ".SIGN.") &&
				header.Name != ".PKGINFO" &&
				header.Name != "APKINDEX" &&
				header.Name != "DESCRIPTION" {
				streamContainsFiles = true
				streamInstalledSize += header.Size
			}
		}

		gzipReader.Close()

		if streamContainsPKGINFO && controlStream == nil {
			controlStream = streamData
		} else if streamContainsFiles && installedSize == 0 {
			installedSize = streamInstalledSize
		}

		if pkgInfoContent != nil && controlStream != nil && installedSize > 0 {
			break
		}
	}

	if pkgInfoContent == nil {
		return nil, nil, 0, fmt.Errorf(".PKGINFO not found in any gzip stream")
	}

	return pkgInfoContent, controlStream, installedSize, nil
}

// calculateAlpineChecksumFromStream calculates Alpine checksum from control stream data
func calculateAlpineChecksumFromStream(controlStreamData []byte) string {
	if controlStreamData == nil {
		return ""
	}

	// Calculate SHA1 of the control stream
	hasher := sha1.New()
	hasher.Write(controlStreamData)
	hashSum := hasher.Sum(nil)

	// Encode to base64 and prefix with Q1
	checksum := "Q1" + base64.StdEncoding.EncodeToString(hashSum)
	return checksum
}

func extractPKGINFOFromAPK(apkPath string) ([]byte, error) {
	f, err := os.Open(apkPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	// Read the entire APK file
	apkData, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}

	// Search through all gzip streams to find .PKGINFO
	return findPKGINFOInAPK(apkData)
}

// findPKGINFOInAPK walks the APK's gzip members and returns the contents of
// the .PKGINFO entry. It intentionally does not scan for 1f 8b magic bytes —
// those can appear inside deflate output and produce truncated "streams" that
// still look valid to gzip.NewReader's header-only validation.
func findPKGINFOInAPK(apkData []byte) ([]byte, error) {
	streams, err := extractAPKStreams(apkData)
	if err != nil {
		return nil, fmt.Errorf("extract gzip streams: %w", err)
	}

	for _, streamData := range streams {
		gzipReader, err := gzip.NewReader(bytes.NewReader(streamData))
		if err != nil {
			continue
		}

		tarReader := tar.NewReader(gzipReader)
		for {
			header, err := tarReader.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				break
			}

			if header.Name == ".PKGINFO" {
				content, readErr := io.ReadAll(tarReader)
				gzipReader.Close()
				if readErr != nil {
					return nil, fmt.Errorf("failed to read .PKGINFO content: %w", readErr)
				}
				return content, nil
			}
		}
		gzipReader.Close()
	}

	return nil, fmt.Errorf(".PKGINFO not found in any gzip stream")
}

func parsePKGINFO(pkgInfoContent []byte) (map[string]string, error) {
	meta := make(map[string]string)
	lines := strings.Split(string(pkgInfoContent), "\n")
	for _, line := range lines {
		if len(line) == 0 || !strings.Contains(line, "=") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])

		// If key already exists, join with space separator
		if existing, exists := meta[key]; exists {
			meta[key] = existing + " " + val
		} else {
			meta[key] = val
		}
	}

	if pkgver, ok := meta["pkgver"]; ok {
		if strings.Contains(pkgver, "-r") {
			parts := strings.SplitN(pkgver, "-r", 2)
			meta["pkgver"] = parts[0]
			meta["pkgrel"] = parts[1]
		} else {
			meta["pkgrel"] = "0"
		}
	}

	// Ensure required fields exist
	for _, field := range []string{"pkgname", "pkgver", "pkgrel", "arch"} {
		if meta[field] == "" {
			return nil, fmt.Errorf("parsePKGINFO: missing required field %q", field)
		}
	}

	return meta, nil
}
