package apk

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func sha1HexOfFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha1.New()
	_, err = io.Copy(h, f)
	if err != nil {
		return "", err
	}

	return hex.EncodeToString(h.Sum(nil)), nil
}

func ParseAPKFilename(filename string) (string, string, string, error) {
	// remove the extension
	filenameWithoutExtension := strings.TrimSuffix(filename, filepath.Ext(filename))

	parts := strings.Split(filenameWithoutExtension, "-")
	if len(parts) < 3 {
		return "", "", "", fmt.Errorf("invalid filename: %s", filename)
	}

	// rel is the last part
	rel := parts[len(parts)-1]

	// version is the second to last part
	version := parts[len(parts)-2]

	// name is the rest
	name := strings.Join(parts[:len(parts)-2], "-")

	return name, version, rel, nil
}

// generateAlpineChecksum generates the C: field checksum for Alpine APKINDEX
// This extracts and hashes the control (second) gzip stream from the APK
func generateAlpineChecksum(filepath string) (string, error) {
	file, err := os.Open(filepath)
	if err != nil {
		return "", fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	// Read the entire APK file
	apkData, err := io.ReadAll(file)
	if err != nil {
		return "", fmt.Errorf("failed to read APK file: %w", err)
	}

	// Try to find the control gzip stream using multiple approaches
	var controlStream []byte

	// First, try the standard approach (second gzip stream)
	controlStream, err = extractControlStream(apkData)
	if err != nil {
		// If that fails, try to find a control stream by looking for .PKGINFO
		controlStream, err = findControlStreamByContent(apkData)
		if err != nil {
			return "", fmt.Errorf("failed to extract control stream: %w", err)
		}
	}

	// Calculate SHA1 of the control stream
	hasher := sha1.New()
	hasher.Write(controlStream)
	hashSum := hasher.Sum(nil)

	// Encode to base64 and prefix with Q1
	checksum := "Q1" + base64.StdEncoding.EncodeToString(hashSum)

	return checksum, nil
}

// extractControlStream finds and extracts the control (second) gzip stream from APK data
func extractControlStream(apkData []byte) ([]byte, error) {
	// Scan for gzip magic bytes to find the second gzip stream
	return findAndExtractSecondGzipStream(apkData)
}

// findAndExtractSecondGzipStream scans for the second gzip magic header
func findAndExtractSecondGzipStream(data []byte) ([]byte, error) {
	gzipMagic := []byte{0x1f, 0x8b}

	// Find all gzip magic occurrences
	var gzipPositions []int
	for i := 0; i < len(data)-1; i++ {
		if data[i] == gzipMagic[0] && data[i+1] == gzipMagic[1] {
			gzipPositions = append(gzipPositions, i)
		}
	}

	if len(gzipPositions) < 2 {
		return nil, fmt.Errorf("could not find second gzip stream")
	}

	// Extract from second gzip position to third (or end of file)
	secondStart := gzipPositions[1]
	var secondEnd int
	if len(gzipPositions) > 2 {
		secondEnd = gzipPositions[2]
	} else {
		secondEnd = len(data)
	}

	controlStream := data[secondStart:secondEnd]

	// Validate it's actually a valid gzip stream
	reader := bytes.NewReader(controlStream)
	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return nil, fmt.Errorf("invalid gzip stream at second position: %w", err)
	}
	gzipReader.Close()

	return controlStream, nil
}

// Alternative: extract control stream by parsing APK structure properly
func extractControlStreamProper(apkData []byte) ([]byte, error) {
	reader := bytes.NewReader(apkData)

	// APK structure: [signature stream][control stream][data stream]
	// We need to read the control stream specifically

	// Skip signature stream if present (first gzip)
	firstGzip, err := gzip.NewReader(reader)
	if err != nil {
		return nil, fmt.Errorf("no signature stream found: %w", err)
	}

	// Read signature stream completely
	_, err = io.Copy(io.Discard, firstGzip)
	if err != nil {
		return nil, fmt.Errorf("failed to read signature stream: %w", err)
	}
	firstGzip.Close()

	// Current reader position should be at control stream
	remainingData := make([]byte, reader.Len())
	n, err := reader.Read(remainingData)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("failed to read remaining data: %w", err)
	}
	remainingData = remainingData[:n]

	// Find next gzip stream (control stream)
	return findFirstGzipStream(remainingData)
}

func findFirstGzipStream(data []byte) ([]byte, error) {
	gzipMagic := []byte{0x1f, 0x8b}

	for i := 0; i < len(data)-1; i++ {
		if data[i] == gzipMagic[0] && data[i+1] == gzipMagic[1] {
			// Found potential gzip start, find its end
			reader := bytes.NewReader(data[i:])
			gzipReader, err := gzip.NewReader(reader)
			if err != nil {
				continue // Not a valid gzip, keep searching
			}

			// Read the gzip stream to find its end
			var buf bytes.Buffer
			_, err = io.Copy(&buf, gzipReader)
			gzipReader.Close()

			if err != nil {
				continue // Invalid gzip stream
			}

			// Calculate how much data the gzip reader consumed
			bytesRead := len(data[i:]) - reader.Len()
			return data[i : i+bytesRead], nil
		}
	}

	return nil, fmt.Errorf("no valid gzip stream found")
}

// extractDataStream finds the data stream (third gzip stream)
func extractDataStream(apkData []byte) ([]byte, error) {
	gzipMagic := []byte{0x1f, 0x8b}

	// Find all gzip magic occurrences
	var gzipPositions []int
	for i := 0; i < len(apkData)-1; i++ {
		if apkData[i] == gzipMagic[0] && apkData[i+1] == gzipMagic[1] {
			gzipPositions = append(gzipPositions, i)
		}
	}

	if len(gzipPositions) < 3 {
		return nil, fmt.Errorf("could not find data stream (third gzip)")
	}

	// Extract from third gzip position to end
	dataStart := gzipPositions[2]
	dataStream := apkData[dataStart:]

	// Validate it's a valid gzip stream
	reader := bytes.NewReader(dataStream)
	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return nil, fmt.Errorf("invalid data stream gzip: %w", err)
	}
	gzipReader.Close()

	return dataStream, nil
}

func calculateInstalledSize(filepath string) (int64, error) {
	file, err := os.Open(filepath)
	if err != nil {
		return 0, fmt.Errorf("failed to open APK file: %w", err)
	}
	defer file.Close()

	// Read entire APK
	apkData, err := io.ReadAll(file)
	if err != nil {
		return 0, fmt.Errorf("failed to read APK: %w", err)
	}

	// Try to find the data stream using multiple approaches
	var dataStream []byte

	// First, try the standard approach (third gzip stream)
	dataStream, err = extractDataStream(apkData)
	if err != nil {
		// If that fails, try to find any stream with actual file data
		dataStream, err = findDataStreamByContent(apkData)
		if err != nil {
			// If we still can't find it, return 0 (unknown size)
			return 0, nil
		}
	}

	// Decompress and calculate total size
	reader := bytes.NewReader(dataStream)
	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return 0, fmt.Errorf("failed to create gzip reader for data stream: %w", err)
	}
	defer gzipReader.Close()

	// Parse tar and sum file sizes
	tarReader := tar.NewReader(gzipReader)
	var totalSize int64

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return 0, fmt.Errorf("failed to read tar entry: %w", err)
		}

		// Only count regular files (not directories, symlinks, etc.)
		if header.Typeflag == tar.TypeReg {
			totalSize += header.Size
		}
	}

	return totalSize, nil
}

// AnalyzeAPKStructure provides detailed analysis of APK file structure for debugging
func AnalyzeAPKStructure(filepath string) (map[string]interface{}, error) {
	file, err := os.Open(filepath)
	if err != nil {
		return nil, fmt.Errorf("failed to open APK file: %w", err)
	}
	defer file.Close()

	// Read entire APK
	apkData, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read APK: %w", err)
	}

	analysis := make(map[string]interface{})
	analysis["file_size"] = len(apkData)

	// Find all gzip magic byte positions
	gzipMagic := []byte{0x1f, 0x8b}
	var gzipPositions []int
	for i := 0; i < len(apkData)-1; i++ {
		if apkData[i] == gzipMagic[0] && apkData[i+1] == gzipMagic[1] {
			gzipPositions = append(gzipPositions, i)
		}
	}

	analysis["gzip_stream_count"] = len(gzipPositions)
	analysis["gzip_positions"] = gzipPositions

	// Try to analyze each gzip stream
	streams := make([]map[string]interface{}, 0)
	for i, pos := range gzipPositions {
		streamInfo := make(map[string]interface{})
		streamInfo["position"] = pos
		streamInfo["stream_number"] = i + 1

		// Determine stream end
		var streamEnd int
		if i+1 < len(gzipPositions) {
			streamEnd = gzipPositions[i+1]
		} else {
			streamEnd = len(apkData)
		}

		streamData := apkData[pos:streamEnd]
		streamInfo["stream_size"] = len(streamData)

		// Try to decompress this stream
		reader := bytes.NewReader(streamData)
		gzipReader, err := gzip.NewReader(reader)
		if err != nil {
			streamInfo["valid_gzip"] = false
			streamInfo["error"] = err.Error()
		} else {
			streamInfo["valid_gzip"] = true

			// Try to read some content to see what's in this stream
			content := make([]byte, 512) // Read first 512 bytes
			n, readErr := gzipReader.Read(content)
			if readErr != nil && readErr != io.EOF {
				streamInfo["content_error"] = readErr.Error()
			} else {
				streamInfo["content_preview"] = string(content[:n])
				streamInfo["content_bytes_read"] = n

				// Check if this looks like a tar stream
				if n >= 512 && content[257] == 'u' && content[258] == 's' && content[259] == 't' && content[260] == 'a' && content[261] == 'r' {
					streamInfo["appears_to_be_tar"] = true
				}
			}
			gzipReader.Close()
		}

		streams = append(streams, streamInfo)
	}

	analysis["streams"] = streams

	// Check if this follows standard APK structure
	if len(gzipPositions) == 1 {
		analysis["structure_type"] = "single_gzip_stream"
		analysis["likely_issue"] = "APK should have multiple gzip streams (signature, control, data)"
	} else if len(gzipPositions) == 2 {
		analysis["structure_type"] = "dual_gzip_stream"
		analysis["likely_issue"] = "APK should have 3 gzip streams, missing one (likely signature or data stream)"
	} else if len(gzipPositions) == 3 {
		analysis["structure_type"] = "triple_gzip_stream"
		analysis["likely_issue"] = "correct_structure"
	} else {
		analysis["structure_type"] = "unusual_structure"
		analysis["likely_issue"] = fmt.Sprintf("unexpected number of gzip streams: %d", len(gzipPositions))
	}

	return analysis, nil
}

// findControlStreamByContent searches for a gzip stream containing .PKGINFO
func findControlStreamByContent(data []byte) ([]byte, error) {
	gzipMagic := []byte{0x1f, 0x8b}

	// Find all potential gzip magic occurrences
	for i := 0; i < len(data)-1; i++ {
		if data[i] == gzipMagic[0] && data[i+1] == gzipMagic[1] {
			// Try to extract this gzip stream
			stream, err := extractSingleGzipStream(data[i:])
			if err != nil {
				continue // Not a valid gzip, keep searching
			}

			// Check if this stream contains .PKGINFO (indicating it's the control stream)
			if containsPKGINFO(stream) {
				return stream, nil
			}
		}
	}

	return nil, fmt.Errorf("no control stream containing .PKGINFO found")
}

// extractSingleGzipStream extracts a single gzip stream starting from the given position
func extractSingleGzipStream(data []byte) ([]byte, error) {
	reader := bytes.NewReader(data)
	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return nil, err
	}
	defer gzipReader.Close()

	// Read the entire gzip stream to determine its boundaries
	var buf bytes.Buffer
	_, err = io.Copy(&buf, gzipReader)
	if err != nil {
		return nil, err
	}

	// Calculate how much data the gzip reader consumed
	bytesRead := len(data) - reader.Len()
	return data[:bytesRead], nil
}

// containsPKGINFO checks if a gzip stream contains .PKGINFO file
func containsPKGINFO(gzipData []byte) bool {
	reader := bytes.NewReader(gzipData)
	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return false
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return false
		}

		if header.Name == ".PKGINFO" {
			return true
		}
	}

	return false
}

// findDataStreamByContent searches for a gzip stream containing actual file data
func findDataStreamByContent(data []byte) ([]byte, error) {
	gzipMagic := []byte{0x1f, 0x8b}

	// Find all potential gzip magic occurrences
	for i := 0; i < len(data)-1; i++ {
		if data[i] == gzipMagic[0] && data[i+1] == gzipMagic[1] {
			// Try to extract this gzip stream
			stream, err := extractSingleGzipStream(data[i:])
			if err != nil {
				continue // Not a valid gzip, keep searching
			}

			// Check if this stream contains actual file data (not control files)
			if containsFileData(stream) {
				return stream, nil
			}
		}
	}

	return nil, fmt.Errorf("no data stream containing file data found")
}

// containsFileData checks if a gzip stream contains actual file data (not just control files)
func containsFileData(gzipData []byte) bool {
	reader := bytes.NewReader(gzipData)
	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return false
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return false
		}

		// Skip control files and signature files
		if header.Name == ".PKGINFO" ||
			strings.HasPrefix(header.Name, ".SIGN.") ||
			header.Name == "APKINDEX" ||
			header.Name == "DESCRIPTION" {
			continue
		}

		// If we find any other file, this is likely the data stream
		if header.Typeflag == tar.TypeReg && header.Size > 0 {
			return true
		}
	}

	return false
}
