package apk

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha1"
	"encoding/base64"
	"os"
	"testing"
)

func TestAnalyzeAPKStructure(t *testing.T) {
	// Create a test file with a single gzip stream
	tmpFile, err := os.CreateTemp("", "test_apk")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	// Create a simple gzip stream
	var buf bytes.Buffer
	gzipWriter := gzip.NewWriter(&buf)
	gzipWriter.Write([]byte("test content"))
	gzipWriter.Close()

	// Write to temp file
	if _, err := tmpFile.Write(buf.Bytes()); err != nil {
		t.Fatalf("Failed to write to temp file: %v", err)
	}
	tmpFile.Close()

	// Test our analysis function
	analysis, err := AnalyzeAPKStructure(tmpFile.Name())
	if err != nil {
		t.Fatalf("AnalyzeAPKStructure failed: %v", err)
	}

	// Verify basic structure
	if analysis["gzip_stream_count"] != 1 {
		t.Errorf("Expected 1 gzip stream, got %v", analysis["gzip_stream_count"])
	}

	if analysis["structure_type"] != "single_gzip_stream" {
		t.Errorf("Expected single_gzip_stream, got %v", analysis["structure_type"])
	}

	// Check that streams array exists and has one element
	streams, ok := analysis["streams"].([]map[string]interface{})
	if !ok {
		t.Errorf("Expected streams to be array of maps")
	}

	if len(streams) != 1 {
		t.Errorf("Expected 1 stream in analysis, got %d", len(streams))
	}

	if streams[0]["valid_gzip"] != true {
		t.Errorf("Expected valid gzip stream, got %v", streams[0]["valid_gzip"])
	}
}

func TestAnalyzeAPKStructure_NonexistentFile(t *testing.T) {
	_, err := AnalyzeAPKStructure("/nonexistent/file")
	if err == nil {
		t.Error("Expected error for nonexistent file, but got nil")
	}
}

// TestGenerateAlpineChecksumInlineGzipMagic guards against a regression where
// the control-stream extractor scanned the APK for 0x1f 0x8b bytes and treated
// every occurrence as a gzip-member boundary. Those two bytes can legitimately
// appear inside deflate output; when they did, the extractor truncated the
// control stream to a still-header-valid (but shorter) slice, producing the
// wrong APKINDEX C: checksum and breaking `apk add` with
// "UNTRUSTED: ... not valid or required".
func TestGenerateAlpineChecksumInlineGzipMagic(t *testing.T) {
	var controlTar bytes.Buffer
	tw := tar.NewWriter(&controlTar)

	pkgInfo := []byte("pkgname = test\npkgver = 1.0-r0\narch = x86_64\n")
	if err := tw.WriteHeader(&tar.Header{Name: ".PKGINFO", Mode: 0644, Size: int64(len(pkgInfo)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatalf("WriteHeader pkginfo: %v", err)
	}
	if _, err := tw.Write(pkgInfo); err != nil {
		t.Fatalf("Write pkginfo: %v", err)
	}

	// Force a false-positive 0x1f 0x8b well inside the compressed payload.
	filler := bytes.Repeat([]byte{0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00}, 200)
	if err := tw.WriteHeader(&tar.Header{Name: ".filler", Mode: 0644, Size: int64(len(filler)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatalf("WriteHeader filler: %v", err)
	}
	if _, err := tw.Write(filler); err != nil {
		t.Fatalf("Write filler: %v", err)
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("tar close: %v", err)
	}

	// NoCompression keeps the filler's bytes verbatim in deflate stored blocks.
	var controlGz bytes.Buffer
	gw, err := gzip.NewWriterLevel(&controlGz, gzip.NoCompression)
	if err != nil {
		t.Fatalf("NewWriterLevel: %v", err)
	}
	if _, err := gw.Write(controlTar.Bytes()); err != nil {
		t.Fatalf("gzip Write: %v", err)
	}
	if err := gw.Close(); err != nil {
		t.Fatalf("gzip Close: %v", err)
	}
	controlStream := controlGz.Bytes()

	// Sanity-check the fixture: inline 0x1f 0x8b must actually be present past
	// the gzip header, otherwise this test would pass trivially.
	foundInline := false
	for i := 10; i < len(controlStream)-1; i++ {
		if controlStream[i] == 0x1f && controlStream[i+1] == 0x8b {
			foundInline = true
			break
		}
	}
	if !foundInline {
		t.Fatalf("test setup: synthetic control stream has no inline 0x1f 0x8b bytes")
	}

	var dataTar bytes.Buffer
	dtw := tar.NewWriter(&dataTar)
	payload := []byte("hello\n")
	if err := dtw.WriteHeader(&tar.Header{Name: "usr/share/hello.txt", Mode: 0644, Size: int64(len(payload)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatalf("WriteHeader data: %v", err)
	}
	if _, err := dtw.Write(payload); err != nil {
		t.Fatalf("Write data: %v", err)
	}
	if err := dtw.Close(); err != nil {
		t.Fatalf("data tar close: %v", err)
	}

	var dataGz bytes.Buffer
	dgw := gzip.NewWriter(&dataGz)
	if _, err := dgw.Write(dataTar.Bytes()); err != nil {
		t.Fatalf("data gzip Write: %v", err)
	}
	if err := dgw.Close(); err != nil {
		t.Fatalf("data gzip Close: %v", err)
	}

	var apkData bytes.Buffer
	apkData.Write(controlStream)
	apkData.Write(dataGz.Bytes())

	tmp, err := os.CreateTemp("", "apk-inline-magic-*.apk")
	if err != nil {
		t.Fatalf("CreateTemp: %v", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(apkData.Bytes()); err != nil {
		t.Fatalf("write apk: %v", err)
	}
	tmp.Close()

	h := sha1.New()
	h.Write(controlStream)
	want := "Q1" + base64.StdEncoding.EncodeToString(h.Sum(nil))

	got, err := generateAlpineChecksum(tmp.Name())
	if err != nil {
		t.Fatalf("generateAlpineChecksum: %v", err)
	}
	if got != want {
		t.Errorf("Alpine checksum mismatch\n  got  %s\n  want %s", got, want)
	}
}

func TestParseAPKFilename(t *testing.T) {
	tests := []struct {
		name        string
		filename    string
		wantName    string
		wantVersion string
		wantRel     string
	}{
		{
			name:        "test1",
			filename:    "test-1.0-r1.apk",
			wantName:    "test",
			wantVersion: "1.0",
			wantRel:     "r1",
		},
		{
			name:        "package-c-1.0.0-r0.apk",
			filename:    "package-c-1.0.0-r0.apk",
			wantName:    "package-c",
			wantVersion: "1.0.0",
			wantRel:     "r0",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotName, gotVersion, gotRel, err := ParseAPKFilename(tt.filename)
			if err != nil {
				t.Errorf("ParseAPKFilename() error = %v", err)
				return
			}

			if gotName != tt.wantName {
				t.Errorf("ParseAPKFilename() gotName = %v, want %v", gotName, tt.wantName)
			}
			if gotVersion != tt.wantVersion {
				t.Errorf("ParseAPKFilename() gotVersion = %v, want %v", gotVersion, tt.wantVersion)
			}
			if gotRel != tt.wantRel {
				t.Errorf("ParseAPKFilename() gotRel = %v, want %v", gotRel, tt.wantRel)
			}
		})
	}
}
