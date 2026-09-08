package apk

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const maxRepositoryIndexSize = 64 << 20

// RepositoryContainsPackage reports whether an exact package revision is
// present in the public APK index for every requested architecture.
func RepositoryContainsPackage(ctx context.Context, repositoryURL, packageName, version string, release int, architectures []string) (bool, error) {
	if repositoryURL == "" {
		return false, fmt.Errorf("APK repository URL is empty")
	}
	if packageName == "" || version == "" {
		return false, fmt.Errorf("package name and version are required")
	}
	if len(architectures) == 0 {
		return false, fmt.Errorf("at least one architecture is required")
	}

	client := &http.Client{Timeout: 5 * time.Second}
	wantedVersion := fmt.Sprintf("%s-r%d", version, release)

	for _, architecture := range architectures {
		indexURL := fmt.Sprintf("%s/%s/APKINDEX.tar.gz", strings.TrimRight(repositoryURL, "/"), architecture)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, indexURL, nil)
		if err != nil {
			return false, fmt.Errorf("create request for %s APK index: %w", architecture, err)
		}

		resp, err := client.Do(req)
		if err != nil {
			return false, fmt.Errorf("fetch %s APK index: %w", architecture, err)
		}

		if resp.StatusCode == http.StatusNotFound {
			resp.Body.Close()
			return false, nil
		}
		if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
			resp.Body.Close()
			return false, fmt.Errorf("fetch %s APK index: unexpected status %s", architecture, resp.Status)
		}

		indexData, readErr := io.ReadAll(io.LimitReader(resp.Body, maxRepositoryIndexSize+1))
		closeErr := resp.Body.Close()
		if readErr != nil {
			return false, fmt.Errorf("read %s APK index: %w", architecture, readErr)
		}
		if closeErr != nil {
			return false, fmt.Errorf("close %s APK index response: %w", architecture, closeErr)
		}
		if len(indexData) > maxRepositoryIndexSize {
			return false, fmt.Errorf("%s APK index exceeds %d bytes", architecture, maxRepositoryIndexSize)
		}

		indexContent, err := extractAPKIndexFromArchive(indexData)
		if err != nil {
			return false, fmt.Errorf("extract %s APK index: %w", architecture, err)
		}
		index, err := parseAPKIndexContent(indexContent)
		if err != nil {
			return false, fmt.Errorf("parse %s APK index: %w", architecture, err)
		}

		found := false
		for _, indexedPackage := range index.Packages {
			if indexedPackage["P"] == packageName && indexedPackage["V"] == wantedVersion {
				found = true
				break
			}
		}
		if !found {
			return false, nil
		}
	}

	return true, nil
}
