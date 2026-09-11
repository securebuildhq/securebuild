package apk

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrInvalidRepositoryRequest identifies errors that waiting for publication
// cannot fix. Fetch, read and index-decoding errors remain retryable.
var ErrInvalidRepositoryRequest = errors.New("invalid APK repository request")

// RepositoryContainsPackage reports whether an exact package revision is
// present in both public APK indexes.
func RepositoryContainsPackage(ctx context.Context, repositoryURL, packageName, version string, release int) (bool, error) {
	repository, err := url.Parse(repositoryURL)
	if err != nil || repository.Host == "" || (repository.Scheme != "https" && repository.Scheme != "http") || repository.RawQuery != "" || repository.Fragment != "" {
		return false, fmt.Errorf("%w: repository must be an HTTP(S) URL without a query or fragment", ErrInvalidRepositoryRequest)
	}
	if strings.TrimSpace(packageName) == "" || strings.TrimSpace(version) == "" || release < 0 {
		return false, fmt.Errorf("%w: package name, version and a nonnegative release are required", ErrInvalidRepositoryRequest)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	wantedVersion := fmt.Sprintf("%s-r%d", version, release)

	for _, architecture := range []string{"aarch64", "x86_64"} {
		indexURL := fmt.Sprintf("%s/%s/APKINDEX.tar.gz", strings.TrimRight(repositoryURL, "/"), architecture)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, indexURL, nil)
		if err != nil {
			return false, fmt.Errorf("%w: create request for %s APK index: %w", ErrInvalidRepositoryRequest, architecture, err)
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
			if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
				return false, fmt.Errorf("%w: fetch %s APK index: %s", ErrInvalidRepositoryRequest, architecture, resp.Status)
			}
			return false, fmt.Errorf("fetch %s APK index: unexpected status %s", architecture, resp.Status)
		}

		indexData, readErr := io.ReadAll(resp.Body)
		closeErr := resp.Body.Close()
		if readErr != nil {
			return false, fmt.Errorf("read %s APK index: %w", architecture, readErr)
		}
		if closeErr != nil {
			return false, fmt.Errorf("close %s APK index response: %w", architecture, closeErr)
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
