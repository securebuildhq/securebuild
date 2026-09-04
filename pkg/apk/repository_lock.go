package apk

import (
	"context"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/persistence"
)

// WithRepositoryLock serializes every APKINDEX mutation for an architecture.
// The session-level advisory lock intentionally spans object storage and cache
// operations so two workers cannot publish from the same stale index snapshot.
func WithRepositoryLock(ctx context.Context, arch string, fn func() error) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()
	lockName := "apk-repository:" + arch
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtext($1))`, lockName); err != nil {
		return fmt.Errorf("acquire repository lock: %w", err)
	}
	defer func() {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtext($1))`, lockName)
	}()
	return fn()
}
