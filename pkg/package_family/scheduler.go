package package_family

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

const (
	// CheckInterval is how often the scheduler checks for package families needing update checks
	CheckInterval = 5 * time.Minute

	// MaxFamiliesPerCycle limits how many families are processed in each scheduler cycle
	MaxFamiliesPerCycle = 25
)

// StartScheduler starts the package family update check scheduler
// It polls the database every CheckInterval to find families that need checking
func StartScheduler(ctx context.Context) error {
	logger.Info("Starting package family update scheduler")

	ticker := time.NewTicker(CheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logger.Info("Package family update scheduler shutting down")
			return nil
		case <-ticker.C:
			if err := processScheduledChecks(ctx); err != nil {
				logger.Error(fmt.Errorf("failed to process scheduled package family checks: %w", err))
			}
		}
	}
}

// familyToCheck holds information about a package family that needs checking
type familyToCheck struct {
	id                    string
	name                  string
	checkFrequencyMinutes int
}

// processScheduledChecks finds package families that are due for update checks
// and enqueues them for processing
func processScheduledChecks(ctx context.Context) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	now := time.Now().UTC()
	query := `
		SELECT id, name, check_frequency_minutes
		FROM package_family
		WHERE check_for_updates_at < $1
		  AND monitoring_enabled = true
		ORDER BY check_for_updates_at ASC
		LIMIT $2
	`

	rows, err := conn.Query(ctx, query, now, MaxFamiliesPerCycle)
	if err != nil {
		return fmt.Errorf("failed to query package families for checking: %w", err)
	}
	defer rows.Close()

	// First, collect all families that need checking
	var familiesToCheck []familyToCheck
	for rows.Next() {
		var family familyToCheck
		if err := rows.Scan(&family.id, &family.name, &family.checkFrequencyMinutes); err != nil {
			return fmt.Errorf("failed to scan package family row: %w", err)
		}
		familiesToCheck = append(familiesToCheck, family)
	}

	// Check for errors from iterating over rows
	if err := rows.Err(); err != nil {
		return fmt.Errorf("error iterating over package family rows: %w", err)
	}

	// Now process each family (enqueue and update schedule)
	var processedCount int
	for _, family := range familiesToCheck {
		// Enqueue package_family_update_check job
		payload := map[string]interface{}{
			"packageFamilyId": family.id,
		}

		payloadJSON, err := json.Marshal(payload)
		if err != nil {
			logger.Warn("Failed to marshal package family update check payload",
				zap.String("familyID", family.id),
				zap.Error(err))
			continue
		}

		if err := persistence.EnqueueWork(ctx, "package_family_update_check", payloadJSON); err != nil {
			logger.Warn("Failed to enqueue package family update check",
				zap.String("familyID", family.id),
				zap.Error(err))
			continue
		}

		// Update next check time: always schedule from NOW + frequency
		// This ensures we never get stuck in a time loop with overdue timestamps
		// Note: last_check_at is updated by the handler when the check completes
		updateQuery := `
		UPDATE package_family
		SET check_for_updates_at = NOW() + make_interval(mins => $1)
		WHERE id = $2
	`
		if _, err := conn.Exec(ctx, updateQuery, family.checkFrequencyMinutes, family.id); err != nil {
			logger.Warn("Failed to update package family check_for_updates_at",
				zap.String("familyID", family.id),
				zap.Error(err))
			// Don't skip - the check was still enqueued successfully
		}

		logger.Info("Enqueued package family update check",
			zap.String("familyID", family.id),
			zap.String("name", family.name),
			zap.Int("checkFrequencyMinutes", family.checkFrequencyMinutes))

		processedCount++
	}

	if processedCount > 0 {
		logger.Info("Processed package families for update checks", zap.Int("count", processedCount))
	}

	return nil
}
