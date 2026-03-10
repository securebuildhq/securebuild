package persistence

import (
	"context"
	"fmt"
	"time"

	"github.com/tuvistavie/securerandom"
)

// Priority levels for work queue items
// 0 (or NULL) = normal priority, 1 = high priority
const (
	PriorityNormal = 0
	PriorityHigh   = 1
)

func EnqueueWork(ctx context.Context, channel string, payload interface{}) error {
	return EnqueueWorkWithPriority(ctx, channel, payload, PriorityNormal)
}

func EnqueueWorkWithPriority(ctx context.Context, channel string, payload interface{}, priority int) error {
	conn := MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	id, err := securerandom.Hex(6)
	if err != nil {
		return fmt.Errorf("failed to generate id: %w", err)
	}

	now := time.Now().UTC()
	_, err = conn.Exec(ctx, `INSERT INTO work_queue (id, channel, payload, created_at, priority) VALUES ($1, $2, $3, $4, $5)`, id, channel, payload, now, priority)
	if err != nil {
		return fmt.Errorf("failed to insert work: %w", err)
	}

	_, err = conn.Exec(ctx, `SELECT pg_notify($1, $2)`, channel, id)
	if err != nil {
		return fmt.Errorf("failed to notify: %w", err)
	}

	return nil
}
