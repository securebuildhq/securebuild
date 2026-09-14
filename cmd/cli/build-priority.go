package cli

import (
	"context"
	"time"

	"github.com/securebuildhq/securebuild/pkg/buildpriority"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

// Populate existing records before scheduling starts, and retry skipped records
// or records written by an older worker during a rolling deployment. Missing
// keys remain eligible under FIFO if migration cannot complete immediately.
func backfillBuildPriority(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
	if err == nil {
		defer conn.Release()
		err = buildpriority.Backfill(ctx, conn)
	}
	if err != nil {
		logger.Warnf("failed to backfill build version keys; unranked builds use FIFO: %v", err)
	}
}

func maintainBuildPriority(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			backfillBuildPriority(ctx)
		}
	}
}
