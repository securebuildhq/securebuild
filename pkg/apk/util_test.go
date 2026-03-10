package apk

import (
	"bytes"
	"compress/gzip"
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
