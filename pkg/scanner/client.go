package scanner

import "context"

// CVEClient is the interface for querying CVE databases
// This allows for easy mocking and testing without real API calls
type CVEClient interface {
	// QueryCVEs queries for all CVEs affecting a specific package and version
	// Returns both fixable and unfixable CVEs
	QueryCVEs(ctx context.Context, packageName, version string) ([]CVE, error)

	// ResolvePackageMapping resolves a package name to its OSV ecosystem identifier
	// This is cached to avoid repeated API calls
	ResolvePackageMapping(ctx context.Context, packageName string) (OSVMapping, error)
}
