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

// readSingleGzipStream decompresses exactly one gzip member at the start of
// data and returns the raw (still-compressed) bytes that member occupies plus
// the unread tail. It uses Multistream(false) so concatenated gzip members
// (as found in .apk files) are walked one at a time.
//
// Fully decompressing the member is what distinguishes real stream boundaries
// from stray 1f 8b byte sequences inside deflate output.
func readSingleGzipStream(data []byte) (stream []byte, rest []byte, err error) {
	reader := bytes.NewReader(data)
	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return nil, nil, err
	}
	gzipReader.Multistream(false)
	_, copyErr := io.Copy(io.Discard, gzipReader)
	closeErr := gzipReader.Close()
	if copyErr != nil {
		return nil, nil, fmt.Errorf("decompress gzip stream: %w", copyErr)
	}
	if closeErr != nil {
		return nil, nil, fmt.Errorf("close gzip reader: %w", closeErr)
	}
	consumed := len(data) - reader.Len()
	return data[:consumed], data[consumed:], nil
}

// extractAPKStreams walks the concatenated gzip members of an APK (signature,
// control, data — or just control, data for unsigned APKs) and returns their
// raw compressed byte slices in order.
func extractAPKStreams(apkData []byte) ([][]byte, error) {
	var streams [][]byte
	rest := apkData
	for len(rest) > 0 {
		stream, next, err := readSingleGzipStream(rest)
		if err != nil {
			break
		}
		streams = append(streams, stream)
		rest = next
	}
	if len(streams) == 0 {
		return nil, fmt.Errorf("no gzip streams found")
	}
	return streams, nil
}

// generateAlpineChecksum generates the C: field checksum for Alpine APKINDEX
// by hashing the control (PKGINFO-containing) gzip stream of the APK.
func generateAlpineChecksum(filepath string) (string, error) {
	file, err := os.Open(filepath)
	if err != nil {
		return "", fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	apkData, err := io.ReadAll(file)
	if err != nil {
		return "", fmt.Errorf("failed to read APK file: %w", err)
	}

	controlStream, err := extractControlStream(apkData)
	if err != nil {
		return "", fmt.Errorf("failed to extract control stream: %w", err)
	}

	hasher := sha1.New()
	hasher.Write(controlStream)
	hashSum := hasher.Sum(nil)
	return "Q1" + base64.StdEncoding.EncodeToString(hashSum), nil
}

// extractControlStream returns the raw compressed bytes of the gzip member
// that contains .PKGINFO (the "control" stream in APK terminology).
func extractControlStream(apkData []byte) ([]byte, error) {
	streams, err := extractAPKStreams(apkData)
	if err != nil {
		return nil, err
	}
	for _, s := range streams {
		if containsPKGINFO(s) {
			return s, nil
		}
	}
	return nil, fmt.Errorf("no control stream (containing .PKGINFO) found")
}

// extractDataStream returns the raw compressed bytes of the gzip member
// containing the package's file payload.
func extractDataStream(apkData []byte) ([]byte, error) {
	streams, err := extractAPKStreams(apkData)
	if err != nil {
		return nil, err
	}
	for _, s := range streams {
		if containsFileData(s) {
			return s, nil
		}
	}
	return nil, fmt.Errorf("no data stream (containing file payload) found")
}

func calculateInstalledSize(filepath string) (int64, error) {
	file, err := os.Open(filepath)
	if err != nil {
		return 0, fmt.Errorf("failed to open APK file: %w", err)
	}
	defer file.Close()

	apkData, err := io.ReadAll(file)
	if err != nil {
		return 0, fmt.Errorf("failed to read APK: %w", err)
	}

	dataStream, err := extractDataStream(apkData)
	if err != nil {
		return 0, fmt.Errorf("failed to extract data stream: %w", err)
	}

	gzipReader, err := gzip.NewReader(bytes.NewReader(dataStream))
	if err != nil {
		return 0, fmt.Errorf("failed to create gzip reader for data stream: %w", err)
	}
	defer gzipReader.Close()

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
