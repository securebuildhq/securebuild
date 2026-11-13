package listener

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
)

const apkoRebuildKeyPrefix = "dependency-apko:"

// publicationRequirements accepts the legacy singleton and the coalesced list.
// Keep every exact revision, including different releases of the same package.
func (p BuildAPKOPayload) publicationRequirements() ([]BuildAPKOTriggerPackage, error) {
	requirements := append([]BuildAPKOTriggerPackage{}, p.TriggerPackages...)
	if p.TriggerPackage != nil {
		requirements = append(requirements, *p.TriggerPackage)
	}
	unique := make(map[BuildAPKOTriggerPackage]bool)
	for _, r := range requirements {
		if strings.TrimSpace(r.Name) == "" || strings.TrimSpace(r.Version) == "" || r.APKRelease < 0 {
			return nil, fmt.Errorf("package name, version and a nonnegative release are required")
		}
		unique[r] = true
	}
	requirements = requirements[:0]
	for r := range unique {
		requirements = append(requirements, r)
	}
	sort.Slice(requirements, func(i, j int) bool {
		a, b := requirements[i], requirements[j]
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		if a.Version != b.Version {
			return a.Version < b.Version
		}
		return a.APKRelease < b.APKRelease
	})
	return requirements, nil
}

// EnqueueBuildAPKO coalesces dependency notifications into one unfinished work
// item per APKO. Its key remains held during dispatch. A bump received during
// dispatch changes the payload, which completion must requeue instead of erase.
// Manual builds continue to use the existing enqueue path.
func EnqueueBuildAPKO(ctx context.Context, incoming BuildAPKOPayload) (string, error) {
	requirements, err := incoming.publicationRequirements()
	if err != nil {
		return "", err
	}
	if incoming.ImageID == "" || incoming.APKOID == "" || len(requirements) == 0 {
		return "", fmt.Errorf("image, APKO and at least one dependency requirement are required")
	}
	conn, err := persistence.GetPooledPostgresSessionWithTimeout(ctx, 10*time.Second)
	if err != nil {
		return "", err
	}
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	key := apkoRebuildKeyPrefix + incoming.APKOID
	// Serialize producers for this APKO, including adoption of pre-upgrade rows.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, key); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE work_queue SET dedupe_key = NULL
		WHERE channel = 'build_apko' AND dedupe_key = $1 AND completed_at IS NOT NULL`, key); err != nil {
		return "", err
	}
	rows, err := tx.Query(ctx, `
		SELECT id, payload, created_at, COALESCE(priority, 0), next_attempt_at,
		       COALESCE(dedupe_key = $1, false)
		FROM work_queue
		WHERE channel = 'build_apko' AND completed_at IS NULL AND (
			dedupe_key = $1 OR (
				dedupe_key IS NULL AND processing_started_at IS NULL
				AND payload->>'imageId' = $2 AND payload->>'apkoId' = $3
				AND CASE WHEN jsonb_typeof(payload) = 'object' THEN
					payload - ARRAY['imageId', 'apkoId', 'triggerPackage', 'triggerPackages', 'publicationWaitStartedAt']
					ELSE NULL END = '{}'::jsonb
				AND (jsonb_typeof(payload->'triggerPackage') = 'object'
					OR jsonb_typeof(payload->'triggerPackages') = 'array')
			)
		)
		ORDER BY (dedupe_key = $1) DESC NULLS LAST, created_at, id
		FOR UPDATE`, key, incoming.ImageID, incoming.APKOID)
	if err != nil {
		return "", err
	}
	var ids []string
	created := time.Now().UTC()
	priority := 0
	var nextAttempt *time.Time
	var waitStartedAt time.Time
	knownRequirements := make(map[BuildAPKOTriggerPackage]bool)
	for rows.Next() {
		var id string
		var raw []byte
		var when time.Time
		var prio int
		var next *time.Time
		var keyed bool
		if err := rows.Scan(&id, &raw, &when, &prio, &next, &keyed); err != nil {
			rows.Close()
			return "", err
		}
		var previous BuildAPKOPayload
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&previous); err != nil {
			if !keyed {
				continue
			}
			rows.Close()
			return "", err
		}
		if previous.ImageID != incoming.ImageID || previous.APKOID != incoming.APKOID {
			rows.Close()
			return "", fmt.Errorf("coalesced APKO identity mismatch")
		}
		reqs, err := previous.publicationRequirements()
		if err != nil {
			if !keyed {
				continue
			}
			rows.Close()
			return "", err
		}
		requirements = append(requirements, reqs...)
		for _, r := range reqs {
			knownRequirements[r] = true
		}
		previousWait := when
		if previous.PublicationWaitStartedAt != nil {
			previousWait = *previous.PublicationWaitStartedAt
		}
		if previousWait.After(waitStartedAt) {
			waitStartedAt = previousWait
		}
		ids = append(ids, id)
		if when.Before(created) {
			created = when
		}
		if prio > priority {
			priority = prio
		}
		if next != nil && (nextAttempt == nil || next.After(*nextAttempt)) {
			nextAttempt = next
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", err
	}
	merged := BuildAPKOPayload{ImageID: incoming.ImageID, APKOID: incoming.APKOID, TriggerPackages: requirements}
	merged.TriggerPackages, err = merged.publicationRequirements()
	if err != nil {
		return "", err
	}
	for _, r := range merged.TriggerPackages {
		if !knownRequirements[r] {
			waitStartedAt = time.Now().UTC()
			break
		}
	}
	merged.PublicationWaitStartedAt = &waitStartedAt
	raw, err := json.Marshal(merged)
	if err != nil {
		return "", err
	}
	var id string
	if len(ids) == 0 {
		id, err = securerandom.Hex(6)
		if err != nil {
			return "", err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO work_queue (id, channel, payload, dedupe_key, created_at, priority)
			VALUES ($1, 'build_apko', $2, $3, $4, $5)`, id, string(raw), key, created, priority)
	} else {
		id = ids[0]
		_, err = tx.Exec(ctx, `
			UPDATE work_queue
			SET payload = $2, dedupe_key = $3, priority = $4, next_attempt_at = $5,
			    attempt_count = CASE
					WHEN processing_started_at IS NULL AND payload IS DISTINCT FROM $2::jsonb THEN 0
					ELSE attempt_count END
			WHERE id = $1`, id, string(raw), key, priority, nextAttempt)
		if err == nil && len(ids) > 1 {
			_, err = tx.Exec(ctx, `
				UPDATE work_queue
				SET completed_at = NOW(), dedupe_key = NULL,
				    result = jsonb_build_object('coalescedInto', $2::text, 'previousResult', result)
				WHERE id = ANY($1)`, ids[1:], id)
		}
	}
	if err != nil {
		return "", err
	}
	if _, err = tx.Exec(ctx, `SELECT pg_notify('build_apko',$1)`, id); err != nil {
		return "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

type queueUpdateExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

// Lock the APKO row through the existing queue completion/retry update. A
// producer must either merge before this check, or enqueue after the key has
// been released at commit; neither ordering can lose a dependency notification.
func beginAPKOQueueUpdate(ctx context.Context, conn *pgxpool.Conn, channel, id string, claimedPayload []byte) (queueUpdateExecutor, func(), bool, error) {
	noop := func() {}
	if channel != "build_apko" {
		return conn, noop, false, nil
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, noop, false, err
	}
	var changed bool
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(dedupe_key LIKE $3, false) AND payload IS DISTINCT FROM $2::jsonb
		FROM work_queue WHERE id = $1 FOR UPDATE`, id, string(claimedPayload), apkoRebuildKeyPrefix+"%").Scan(&changed)
	if err != nil {
		tx.Rollback(ctx)
		return nil, noop, false, err
	}
	if changed {
		_, err = tx.Exec(ctx, `
			UPDATE work_queue
			SET processing_started_at = NULL, next_attempt_at = NOW(), attempt_count = 0, last_error = NULL
			WHERE id = $1`, id)
		if err == nil {
			_, err = tx.Exec(ctx, `SELECT pg_notify('build_apko',$1)`, id)
		}
		if err == nil {
			err = tx.Commit(ctx)
		} else {
			tx.Rollback(ctx)
		}
		return nil, noop, true, err
	}
	finish := func() {
		if err := tx.Commit(ctx); err != nil {
			logger.Error(fmt.Errorf("commit APKO queue update: %w", err))
		}
	}
	return tx, finish, false, nil
}
