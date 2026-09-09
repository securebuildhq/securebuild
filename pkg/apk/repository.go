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

const maxRepositoryIndexSize = 64 << 20

// ErrInvalidRepositoryRequest identifies errors that waiting for publication
// cannot fix. Fetch, read and index-decoding errors remain retryable.
var ErrInvalidRepositoryRequest = errors.New("invalid APK repository request")

// RepositoryContainsPackage reports whether an exact package revision is
// present in the public APK index for every requested architecture.
func RepositoryContainsPackage(ctx context.Context, repositoryURL, packageName, version string, release int, architectures []string) (bool, error) {
	return RepositoryContainsPackages(ctx, repositoryURL, []string{packageName}, version, release, architectures)
}

// RepositoryContainsPackages reports whether every exact package revision is
// present in the public APK index for every requested architecture.
func RepositoryContainsPackages(ctx context.Context, repositoryURL string, packageNames []string, version string, release int, architectures []string) (bool, error) {
	repository, err := url.Parse(repositoryURL)
	if err != nil || repository.Host == "" || (repository.Scheme != "https" && repository.Scheme != "http") || repository.RawQuery != "" || repository.Fragment != "" {
		return false, fmt.Errorf("%w: repository must be an HTTP(S) URL without a query or fragment", ErrInvalidRepositoryRequest)
	}
	if len(packageNames) == 0 || strings.TrimSpace(version) == "" || release < 0 {
		return false, fmt.Errorf("%w: package names, version and a nonnegative release are required", ErrInvalidRepositoryRequest)
	}
	for _, packageName := range packageNames {
		if strings.TrimSpace(packageName) == "" {
			return false, fmt.Errorf("%w: package names cannot be empty", ErrInvalidRepositoryRequest)
		}
	}
	if len(architectures) == 0 {
		return false, fmt.Errorf("%w: at least one architecture is required", ErrInvalidRepositoryRequest)
	}
	for _, architecture := range architectures {
		if architecture != "aarch64" && architecture != "x86_64" {
			return false, fmt.Errorf("%w: unsupported architecture %q", ErrInvalidRepositoryRequest, architecture)
		}
	}

	client := &http.Client{Timeout: 5 * time.Second}
	wantedVersion := fmt.Sprintf("%s-r%d", version, release)

	for _, architecture := range architectures {
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

		foundPackages := make(map[string]struct{}, len(packageNames))
		for _, indexedPackage := range index.Packages {
			if indexedPackage["V"] == wantedVersion {
				foundPackages[indexedPackage["P"]] = struct{}{}
			}
		}
		for _, packageName := range packageNames {
			if _, found := foundPackages[packageName]; !found {
				return false, nil
			}
		}
	}

	return true, nil
}
