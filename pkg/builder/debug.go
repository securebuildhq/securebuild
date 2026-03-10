package builder

import (
	"context"
	"fmt"
	"io/fs"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

func UpdateFilesystemArchives(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	tx, err := conn.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		DELETE FROM build_filesystem
	`)
	if err != nil {
		return fmt.Errorf("failed to delete existing filesystem: %w", err)
	}

	// Walk through the embedded filesystem and add files to tar
	err = fs.WalkDir(EmbeddedFS(), "filesystem", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		// Skip directories
		if d.IsDir() {
			return nil
		}

		// Read file content from embedded filesystem
		content, err := fs.ReadFile(EmbeddedFS(), path)
		if err != nil {
			return fmt.Errorf("failed to read file %s: %w", path, err)
		}

		path = strings.TrimPrefix(path, "filesystem/")

		_, err = tx.Exec(ctx, `
			INSERT INTO build_filesystem (filename, content)
			VALUES ($1, $2)
		`, path, content)
		if err != nil {
			return fmt.Errorf("failed to insert file %s: %w", path, err)
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("failed to walk filesystem: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}
