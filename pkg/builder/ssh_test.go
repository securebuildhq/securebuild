package builder

import (
	"crypto/sha256"
	"fmt"
	"os"
	"testing"
)

func TestGetLocalFileChecksum(t *testing.T) {
	// Create a temporary file with known content
	content := "Hello, World! This is a test file for checksum verification."
	tmpFile, err := os.CreateTemp("", "checksum_test")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	if _, err := tmpFile.WriteString(content); err != nil {
		t.Fatalf("Failed to write to temp file: %v", err)
	}
	tmpFile.Close()

	// Calculate expected checksum
	hasher := sha256.New()
	hasher.Write([]byte(content))
	expectedChecksum := fmt.Sprintf("%x", hasher.Sum(nil))

	// Test our function
	actualChecksum, err := GetLocalFileChecksum(tmpFile.Name())
	if err != nil {
		t.Fatalf("GetLocalFileChecksum failed: %v", err)
	}

	if actualChecksum != expectedChecksum {
		t.Errorf("Checksum mismatch: expected %s, got %s", expectedChecksum, actualChecksum)
	}
}

func TestGetLocalFileChecksum_EmptyFile(t *testing.T) {
	// Create an empty temporary file
	tmpFile, err := os.CreateTemp("", "empty_checksum_test")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())
	tmpFile.Close()

	// Calculate expected checksum for empty file
	hasher := sha256.New()
	expectedChecksum := fmt.Sprintf("%x", hasher.Sum(nil))

	// Test our function
	actualChecksum, err := GetLocalFileChecksum(tmpFile.Name())
	if err != nil {
		t.Fatalf("GetLocalFileChecksum failed: %v", err)
	}

	if actualChecksum != expectedChecksum {
		t.Errorf("Empty file checksum mismatch: expected %s, got %s", expectedChecksum, actualChecksum)
	}
}

func TestGetLocalFileChecksum_NonexistentFile(t *testing.T) {
	// Test with a file that doesn't exist
	_, err := GetLocalFileChecksum("/nonexistent/file/path")
	if err == nil {
		t.Error("Expected error for nonexistent file, but got nil")
	}
}
