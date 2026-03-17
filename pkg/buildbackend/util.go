package buildbackend

import (
	"context"

	"github.com/securebuildhq/securebuild/pkg/param"
)

// getMaxParallelBuildsFromCtx returns the max parallel builds from config, defaulting to 1.
func getMaxParallelBuildsFromCtx(ctx context.Context) int {
	p := param.TryGetParam(ctx)
	if p != nil && p.MaxParallelBuilds > 0 {
		return p.MaxParallelBuilds
	}
	return 1
}
