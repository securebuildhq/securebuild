package releasemonitor

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"chainguard.dev/melange/pkg/config"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"go.uber.org/zap"
)

// TestParameterValues holds test-specific parameter overrides for the release-monitor API.
// This is primarily used for integration testing to override default behavior.
type TestParameterValues struct {
	BaseURL string // Custom base URL for the release-monitor API (e.g., for mocking)
}

// Context key for test parameter values (for testing)
type testParameterValuesKey struct{}

// WithTestParameters returns a context with test parameter values for the release-monitor API.
// This is primarily used for testing to override the default API endpoint and other parameters.
func WithTestParameters(ctx context.Context, params TestParameterValues) context.Context {
	return context.WithValue(ctx, testParameterValuesKey{}, params)
}

// getTestParameters retrieves test parameters from context, or returns nil if not set.
func getTestParameters(ctx context.Context) *TestParameterValues {
	if params, ok := ctx.Value(testParameterValuesKey{}).(TestParameterValues); ok {
		return &params
	}
	return nil
}

// getBaseURL retrieves the base URL from context, or returns the default if not set.
func getBaseURL(ctx context.Context) string {
	params := getTestParameters(ctx)
	if params != nil && params.BaseURL != "" {
		return params.BaseURL
	}
	return "https://release-monitoring.org"
}

// Response represents the response from release-monitoring.org API
type Response struct {
	LatestVersion  string   `json:"latest_version"`
	StableVersions []string `json:"stable_versions"`
	Versions       []string `json:"versions"`
}

// FetchVersions queries the release-monitoring.org API and returns all available versions
func FetchVersions(ctx context.Context, projectID int) (*Response, error) {
	values := url.Values{
		"project_id": {strconv.Itoa(projectID)},
	}
	baseURL := getBaseURL(ctx)
	apiURL := fmt.Sprintf("%s/api/v2/versions/?%s", baseURL, values.Encode())

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request %s: %w", apiURL, err)
	}

	token := param.GetParam(ctx).ReleaseMonitorAPIToken
	if token != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Token %s", token))
	}
	// These headers seems to prevent CAPTCHA responses. There is no documentation of any kind about this.
	// The API token itself seems to be optional, and its presence has no effect on CAPTCHA check.
	req.Header.Set("User-Agent", "curl/8.7.1")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to query %s: %w", apiURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("%s API returned status %d, %s", apiURL, resp.StatusCode, body)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body %s: %w", apiURL, err)
	}

	var result Response
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response from %s: %s: %w", apiURL, body, err)
	}

	return &result, nil
}

// ApplyTransformations applies strip prefix/suffix transformations to a version string
func ApplyTransformations(version string, releaseMonitor *config.ReleaseMonitor) string {
	if releaseMonitor == nil {
		return version
	}

	result := version
	if releaseMonitor.StripPrefix != "" {
		result = strings.TrimPrefix(result, releaseMonitor.StripPrefix)
	}
	if releaseMonitor.StripSuffix != "" {
		result = strings.TrimSuffix(result, releaseMonitor.StripSuffix)
	}
	return result
}

// GetAllVersions combines stable_versions and versions, preferring stable versions
func GetAllVersions(response *Response) []string {
	if response == nil {
		return nil
	}

	allVersions := make([]string, len(response.StableVersions))
	copy(allVersions, response.StableVersions)

	// Add versions that aren't already in stable_versions
	for _, v := range response.Versions {
		found := false
		for _, sv := range response.StableVersions {
			if sv == v {
				found = true
				break
			}
		}
		if !found {
			allVersions = append(allVersions, v)
		}
	}

	logger.Debug("release-monitor versions",
		zap.Int("stable_count", len(response.StableVersions)),
		zap.Int("all_count", len(response.Versions)),
		zap.Int("combined_count", len(allVersions)))

	return allVersions
}
