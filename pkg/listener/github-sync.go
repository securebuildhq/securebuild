package listener

import (
	"context"

	"github.com/securebuildhq/securebuild/pkg/githubsync"
)

// handleGitHubSync handles the github_sync event
func handleGitHubSync(ctx context.Context, payload string) error {
	if err := githubsync.PerformSync(ctx); err != nil {
		return err
	}
	return nil
}
