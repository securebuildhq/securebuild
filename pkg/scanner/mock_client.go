package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// MockCVEClient is a test implementation of CVEClient that uses local fixtures
type MockCVEClient struct {
	fixturesDir string
	cveData     map[string][]CVE      // map[packageName-version][]CVE
	mappings    map[string]OSVMapping // map[packageName]OSVMapping
}

// NewMockCVEClient creates a new mock client that loads fixtures from the specified directory
func NewMockCVEClient(fixturesDir string) (*MockCVEClient, error) {
	client := &MockCVEClient{
		fixturesDir: fixturesDir,
		cveData:     make(map[string][]CVE),
		mappings:    make(map[string]OSVMapping),
	}

	// Load fixtures
	if err := client.loadFixtures(); err != nil {
		return nil, fmt.Errorf("loading fixtures: %w", err)
	}

	return client, nil
}

// loadFixtures loads all fixture files from the testdata directory
func (m *MockCVEClient) loadFixtures() error {
	// Load OSV response fixtures
	osvDir := filepath.Join(m.fixturesDir, "osv_responses")
	if err := m.loadOSVFixtures(osvDir); err != nil {
		return fmt.Errorf("loading OSV fixtures: %w", err)
	}

	// Load package mappings
	mappingsFile := filepath.Join(m.fixturesDir, "mappings", "package_to_osv.json")
	if err := m.loadMappings(mappingsFile); err != nil {
		return fmt.Errorf("loading mappings: %w", err)
	}

	return nil
}

// loadOSVFixtures loads OSV response fixtures
func (m *MockCVEClient) loadOSVFixtures(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			// Directory doesn't exist yet, that's ok
			return nil
		}
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		filePath := filepath.Join(dir, entry.Name())
		data, err := os.ReadFile(filePath)
		if err != nil {
			return fmt.Errorf("reading %s: %w", filePath, err)
		}

		var response OSVResponse
		if err := json.Unmarshal(data, &response); err != nil {
			return fmt.Errorf("parsing %s: %w", filePath, err)
		}

		// Store CVEs by package name (filename without extension)
		key := entry.Name()[:len(entry.Name())-5] // remove .json
		m.cveData[key] = response.Vulns
	}

	return nil
}

// loadMappings loads package name to OSV mappings
func (m *MockCVEClient) loadMappings(filePath string) error {
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			// File doesn't exist yet, that's ok
			return nil
		}
		return err
	}

	var mappings []OSVMapping
	if err := json.Unmarshal(data, &mappings); err != nil {
		return fmt.Errorf("parsing mappings: %w", err)
	}

	for _, mapping := range mappings {
		m.mappings[mapping.PackageName] = mapping
	}

	return nil
}

// QueryCVEs returns CVEs from fixtures for the given package and version
func (m *MockCVEClient) QueryCVEs(ctx context.Context, packageName, version string) ([]CVE, error) {
	// Look up by package-version key
	key := fmt.Sprintf("%s-%s", packageName, version)
	if cves, ok := m.cveData[key]; ok {
		return cves, nil
	}

	// Also try just package name (for fixtures that cover all versions)
	if cves, ok := m.cveData[packageName]; ok {
		return cves, nil
	}

	// No fixtures found, return empty list
	return []CVE{}, nil
}

// ResolvePackageMapping returns the OSV mapping from fixtures
func (m *MockCVEClient) ResolvePackageMapping(ctx context.Context, packageName string) (OSVMapping, error) {
	if mapping, ok := m.mappings[packageName]; ok {
		return mapping, nil
	}

	// Return a default mapping if not found
	return OSVMapping{
		PackageName:    packageName,
		OSVEcosystem:   "Alpine",
		OSVPackageName: packageName,
	}, nil
}

// OSVResponse represents the structure of OSV API responses
type OSVResponse struct {
	Vulns []CVE `json:"vulns"`
}
