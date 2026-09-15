package buildpriority

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Backfill fills missing keys in small transactions. Empty keys mark unsupported
// versions as processed. Row locks prevent overwriting concurrent tag changes;
// locked records are skipped so other batches can progress. A final check fails
// if any keys remain missing or stale; rerunning resumes the migration safely.
// Run after SchemaHero adds the columns and all artifact writers are updated.
func Backfill(ctx context.Context, db interface {
	Begin(context.Context) (pgx.Tx, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}) error {
	for _, table := range []string{"package_version", "image_apko"} {
		source := "ARRAY[version]"
		predicate := "version_sort_key IS NULL"
		extraSet := ""
		if table == "image_apko" {
			source = "tags"
			predicate += " OR version_sort_tags IS DISTINCT FROM tags"
			extraSet = ", version_sort_tags = artifact.tags"
		}
		cursor := ""
		for {
			next, count, err := backfillBatch(ctx, db, table, source, predicate, extraSet, cursor)
			if err != nil {
				return fmt.Errorf("backfill %s version keys: %w", table, err)
			}
			if count == 0 {
				break
			}
			cursor = next
		}
	}
	// Check both tables together after all batches, including rows that were
	// locked or became stale behind the cursor. Never report partial success.
	var packages, images int64
	err := db.QueryRow(ctx, `SELECT
		(SELECT COUNT(*) FROM package_version WHERE version_sort_key IS NULL),
		(SELECT COUNT(*) FROM image_apko
		 WHERE version_sort_key IS NULL OR version_sort_tags IS DISTINCT FROM tags)
	`).Scan(&packages, &images)
	if err != nil {
		return fmt.Errorf("verify version-key backfill: %w", err)
	}
	if packages != 0 || images != 0 {
		return fmt.Errorf("version-key backfill incomplete: %d package versions and %d image APKOs remain; release conflicting locks and rerun", packages, images)
	}
	return nil
}

func backfillBatch(ctx context.Context, db interface {
	Begin(context.Context) (pgx.Tx, error)
}, table, source, predicate, extraSet, cursor string) (string, int, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return "", 0, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT id, `+source+` FROM `+table+`
		WHERE (`+predicate+`) AND id > $1 ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED`, cursor)
	if err != nil {
		return "", 0, err
	}
	defer rows.Close()
	var ids, keys []string
	for rows.Next() {
		var id string
		var versions []string
		if err := rows.Scan(&id, &versions); err != nil {
			return "", 0, err
		}
		ids = append(ids, id)
		keys = append(keys, VersionKey(versions...))
	}
	if err := rows.Err(); err != nil {
		return "", 0, err
	}
	rows.Close()
	if len(ids) == 0 {
		return "", 0, nil
	}
	_, err = tx.Exec(ctx, `UPDATE `+table+` AS artifact SET version_sort_key = k.key`+extraSet+`
		FROM unnest($1::text[], $2::text[]) AS k(id, key) WHERE artifact.id = k.id`, ids, keys)
	if err != nil {
		return "", 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", 0, err
	}
	return ids[len(ids)-1], len(ids), nil
}
