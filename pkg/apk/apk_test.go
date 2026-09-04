package apk

import (
	"context"
	"os"
	"testing"
)

func TestAddAPKToIndexReplacesExactVersion(t *testing.T) {
	first := map[string]string{
		"pkgname":         "example",
		"pkgver":          "1.0.0",
		"pkgrel":          "0",
		"alpine_checksum": "Q1first",
	}
	second := map[string]string{
		"pkgname":         "example",
		"pkgver":          "1.0.0",
		"pkgrel":          "0",
		"alpine_checksum": "Q1second",
	}

	indexPath, err := AddAPKToIndex(context.Background(), first, "")
	if err != nil {
		t.Fatalf("add first APK: %v", err)
	}
	t.Cleanup(func() { _ = os.Remove(indexPath) })

	indexPath, err = AddAPKToIndex(context.Background(), second, indexPath)
	if err != nil {
		t.Fatalf("replace APK: %v", err)
	}

	index, err := ExtractAPKIndex(indexPath)
	if err != nil {
		t.Fatalf("extract APKINDEX: %v", err)
	}
	if len(index.Packages) != 1 {
		t.Fatalf("got %d package entries, want 1", len(index.Packages))
	}
	if got := index.Packages[0]["C"]; got != "Q1second" {
		t.Fatalf("checksum = %q, want %q", got, "Q1second")
	}
}
