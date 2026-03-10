package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// APIPackageVersion represents a package version from the API
type APIPackageVersion struct {
	Version      string `json:"version"`
	Architecture string `json:"architecture"`
	Filename     string `json:"filename"`
}

// APIPackageResponse represents the API response for package availability
type APIPackageResponse struct {
	PackageName string              `json:"package_name"`
	Available   bool                `json:"available"`
	Versions    []APIPackageVersion `json:"versions"`
}

// checkPackageAvailability checks which packages are available using the API endpoint
func checkPackageAvailability(ctx context.Context, filteredSBOM *FilteredSBOM, apiEndpoint string) ([]MissingPackage, error) {
	fmt.Printf("    Checking package availability via API (%s)...\n", apiEndpoint)

	var missingPackages []MissingPackage
	var availableCount int

	// Create HTTP client with timeout
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	for _, pkg := range filteredSBOM.Packages {
		available, err := isPackageAvailableViaAPI(ctx, client, pkg.Name, apiEndpoint)
		if err != nil {
			fmt.Printf("    Warning: failed to check package %s: %v\n", pkg.Name, err)
			// Treat as missing if we can't check
			missingPackages = append(missingPackages, MissingPackage{
				Name:    pkg.Name,
				Version: pkg.Version,
				Type:    pkg.Type,
			})
			continue
		}

		if available {
			availableCount++
			fmt.Printf("    ✓ %s (available)\n", pkg.Name)
		} else {
			missingPackages = append(missingPackages, MissingPackage{
				Name:    pkg.Name,
				Version: pkg.Version,
				Type:    pkg.Type,
			})
			fmt.Printf("    ✗ %s (missing)\n", pkg.Name)
		}
	}

	fmt.Printf("    Found %d available packages, %d missing packages\n", availableCount, len(missingPackages))
	return missingPackages, nil
}

// isPackageAvailableViaAPI checks if a package is available via the API endpoint
func isPackageAvailableViaAPI(ctx context.Context, client *http.Client, packageName, apiEndpoint string) (bool, error) {
	// Build the API URL
	apiURL, err := url.Parse(apiEndpoint)
	if err != nil {
		return false, fmt.Errorf("invalid API endpoint: %w", err)
	}

	apiURL.Path = "/api/v1/package"
	query := apiURL.Query()
	query.Set("package_name", packageName)
	apiURL.RawQuery = query.Encode()

	// Create request with context
	req, err := http.NewRequestWithContext(ctx, "GET", apiURL.String(), nil)
	if err != nil {
		return false, fmt.Errorf("failed to create request: %w", err)
	}

	// Make the request
	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read the response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, fmt.Errorf("failed to read response body: %w", err)
	}

	// Handle different status codes
	switch resp.StatusCode {
	case 200:
		// Package is available
		var apiResp APIPackageResponse
		if err := json.Unmarshal(body, &apiResp); err != nil {
			return false, fmt.Errorf("failed to decode API response: %w", err)
		}
		return apiResp.Available, nil
	case 404:
		// Package is not available
		return false, nil
	default:
		return false, fmt.Errorf("API returned status %d", resp.StatusCode)
	}
}
