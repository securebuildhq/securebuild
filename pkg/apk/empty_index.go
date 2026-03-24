package apk

import (
	"context"
	"fmt"
	"os"
)

// EmptySignedAPKIndexTarGz returns a signed APKINDEX.tar.gz with no packages.
// Used when object storage has no index yet so apk/melange clients get 200 instead of 404
// and can combine this repo with others (e.g. upstream Wolfi).
func EmptySignedAPKIndexTarGz(ctx context.Context) ([]byte, error) {
	f, err := os.CreateTemp("", "apk-empty-index-*.tar.gz")
	if err != nil {
		return nil, fmt.Errorf("create temp for empty index: %w", err)
	}

	path := f.Name()
	defer os.Remove(path)

	if err := f.Close(); err != nil {
		return nil, fmt.Errorf("close temp: %w", err)
	}

	if err := writeAPKIndex(path, &APKIndex{Packages: []map[string]string{}}); err != nil {
		return nil, fmt.Errorf("write empty APKINDEX: %w", err)
	}

	if err := SignAPKIndex(ctx, path); err != nil {
		return nil, fmt.Errorf("sign empty APKINDEX: %w", err)
	}

	return os.ReadFile(path)
}
