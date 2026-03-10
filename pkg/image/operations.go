package image

import (
	"context"

	"github.com/securebuildhq/securebuild/pkg/image/types"
)

// APKOOperations defines the interface for apko-related operations that may need to be mocked in tests.
// This includes operations that require external resources like the apko binary or network access.
type APKOOperations interface {
	// ListPackages resolves the packages for an APKO configuration.
	// In production, this calls the apko binary. In tests, it can be mocked.
	ListPackages(ctx context.Context, apkoYAML string) ([]types.APKPackageVersion, error)
}

// DefaultAPKOOperations is the production implementation that calls the real apko binary.
type DefaultAPKOOperations struct{}

// ListPackages calls the real apko binary to resolve packages.
func (d *DefaultAPKOOperations) ListPackages(ctx context.Context, apkoYAML string) ([]types.APKPackageVersion, error) {
	return ListPackagesForAPKO(ctx, apkoYAML)
}

// defaultAPKOOps is the default apko operations instance used by the package.
var defaultAPKOOps APKOOperations = &DefaultAPKOOperations{}

// SetAPKOOperations allows tests to inject a mock implementation.
func SetAPKOOperations(ops APKOOperations) {
	defaultAPKOOps = ops
}

// GetAPKOOperations returns the current apko operations instance.
func GetAPKOOperations() APKOOperations {
	return defaultAPKOOps
}

// ResetAPKOOperations restores the default apko operations implementation.
func ResetAPKOOperations() {
	defaultAPKOOps = &DefaultAPKOOperations{}
}
