//go:build integration
// +build integration

package team

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/lib/pq"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

// TestTeamFeatureFlagsIntegration provides comprehensive integration tests for feature flag functionality
func TestTeamFeatureFlagsIntegration(t *testing.T) {
	ctx := context.Background()

	// Create test team with known feature flags
	testTeamID := setupTestTeamWithFlags(t, []string{"custom_melange_upload", "test_feature"})
	defer cleanupTestTeamIntegration(t, testTeamID)

	t.Run("GetTeamWithFeatureFlags - existing team", func(t *testing.T) {
		team, err := GetTeamWithFeatureFlags(ctx, testTeamID)
		if err != nil {
			t.Fatalf("GetTeamWithFeatureFlags failed: %v", err)
		}

		if team == nil {
			t.Fatal("Expected team to be non-nil")
		}

		if team.ID != testTeamID {
			t.Errorf("Expected team ID %s, got %s", testTeamID, team.ID)
		}

		if team.FeatureFlags == nil {
			t.Error("Expected feature flags to be non-nil")
		}

		if len(team.FeatureFlags) != 2 {
			t.Errorf("Expected 2 feature flags, got %d", len(team.FeatureFlags))
		}

		expectedFlags := map[string]bool{
			"custom_melange_upload": false,
			"test_feature":          false,
		}

		for _, flag := range team.FeatureFlags {
			if _, exists := expectedFlags[flag]; !exists {
				t.Errorf("Unexpected feature flag: %s", flag)
			} else {
				expectedFlags[flag] = true
			}
		}

		for flag, found := range expectedFlags {
			if !found {
				t.Errorf("Expected feature flag not found: %s", flag)
			}
		}
	})

	t.Run("GetTeamWithFeatureFlags - non-existent team", func(t *testing.T) {
		nonExistentID := "non-existent-team-12345"

		team, err := GetTeamWithFeatureFlags(ctx, nonExistentID)

		if err == nil {
			t.Error("Expected error for non-existent team")
		}

		if err != sql.ErrNoRows {
			t.Errorf("Expected sql.ErrNoRows, got %v", err)
		}

		if team != nil {
			t.Error("Expected nil team for non-existent team")
		}
	})

	t.Run("HasFeatureFlag - team has flag", func(t *testing.T) {
		hasFlag, err := HasFeatureFlag(ctx, testTeamID, "custom_melange_upload")
		if err != nil {
			t.Fatalf("HasFeatureFlag failed: %v", err)
		}

		if !hasFlag {
			t.Error("Expected team to have 'custom_melange_upload' flag")
		}
	})

	t.Run("HasFeatureFlag - team does not have flag", func(t *testing.T) {
		hasFlag, err := HasFeatureFlag(ctx, testTeamID, "nonexistent_feature")
		if err != nil {
			t.Fatalf("HasFeatureFlag failed: %v", err)
		}

		if hasFlag {
			t.Error("Expected team to not have 'nonexistent_feature' flag")
		}
	})

	t.Run("HasFeatureFlag - case sensitivity", func(t *testing.T) {
		hasFlag, err := HasFeatureFlag(ctx, testTeamID, "CUSTOM_MELANGE_UPLOAD")
		if err != nil {
			t.Fatalf("HasFeatureFlag failed: %v", err)
		}

		if hasFlag {
			t.Error("Expected case sensitivity - 'CUSTOM_MELANGE_UPLOAD' should not match 'custom_melange_upload'")
		}
	})

	t.Run("HasFeatureFlag - non-existent team", func(t *testing.T) {
		nonExistentID := "non-existent-team-67890"

		hasFlag, err := HasFeatureFlag(ctx, nonExistentID, "any_flag")

		if err == nil {
			t.Error("Expected error for non-existent team")
		}

		if err != sql.ErrNoRows {
			t.Errorf("Expected sql.ErrNoRows, got %v", err)
		}

		if hasFlag {
			t.Error("Expected false for non-existent team")
		}
	})

	t.Run("UpdateTeamFeatureFlags - add new flags", func(t *testing.T) {
		newFlags := []string{"custom_apko_upload", "beta_feature", "experimental"}

		err := UpdateTeamFeatureFlags(ctx, testTeamID, newFlags)
		if err != nil {
			t.Fatalf("UpdateTeamFeatureFlags failed: %v", err)
		}

		// Verify the update worked
		team, err := GetTeamWithFeatureFlags(ctx, testTeamID)
		if err != nil {
			t.Fatalf("Failed to verify update: %v", err)
		}

		if len(team.FeatureFlags) != 3 {
			t.Errorf("Expected 3 feature flags after update, got %d", len(team.FeatureFlags))
		}

		expectedFlags := map[string]bool{
			"custom_apko_upload": false,
			"beta_feature":       false,
			"experimental":       false,
		}

		for _, flag := range team.FeatureFlags {
			if _, exists := expectedFlags[flag]; !exists {
				t.Errorf("Unexpected feature flag after update: %s", flag)
			} else {
				expectedFlags[flag] = true
			}
		}

		for flag, found := range expectedFlags {
			if !found {
				t.Errorf("Expected feature flag not found after update: %s", flag)
			}
		}
	})

	t.Run("UpdateTeamFeatureFlags - empty array", func(t *testing.T) {
		emptyFlags := []string{}

		err := UpdateTeamFeatureFlags(ctx, testTeamID, emptyFlags)
		if err != nil {
			t.Fatalf("UpdateTeamFeatureFlags with empty array failed: %v", err)
		}

		// Verify the update worked
		team, err := GetTeamWithFeatureFlags(ctx, testTeamID)
		if err != nil {
			t.Fatalf("Failed to verify empty array update: %v", err)
		}

		if len(team.FeatureFlags) != 0 {
			t.Errorf("Expected 0 feature flags after empty array update, got %d", len(team.FeatureFlags))
		}
	})

	t.Run("UpdateTeamFeatureFlags - non-existent team", func(t *testing.T) {
		nonExistentID := "non-existent-team-update-test"
		flags := []string{"some_flag"}

		// The update will succeed but affect 0 rows
		// This is a limitation of the current implementation
		err := UpdateTeamFeatureFlags(ctx, nonExistentID, flags)
		if err != nil {
			t.Fatalf("UpdateTeamFeatureFlags for non-existent team failed: %v", err)
		}

		// Verify no team was created
		_, err = GetTeamWithFeatureFlags(ctx, nonExistentID)
		if err == nil {
			t.Error("Expected error when trying to get non-existent team after update")
		}
	})
}

// TestTeamFeatureFlagsWithEmptyFlags tests handling of teams with empty or null feature flags
func TestTeamFeatureFlagsWithEmptyFlags(t *testing.T) {
	ctx := context.Background()

	// Create test team with empty feature flags
	emptyTeamID := setupTestTeamWithFlags(t, []string{})
	defer cleanupTestTeamIntegration(t, emptyTeamID)

	t.Run("GetTeamWithFeatureFlags - empty flags", func(t *testing.T) {
		team, err := GetTeamWithFeatureFlags(ctx, emptyTeamID)
		if err != nil {
			t.Fatalf("GetTeamWithFeatureFlags failed: %v", err)
		}

		if team == nil {
			t.Fatal("Expected team to be non-nil")
		}

		if team.FeatureFlags == nil {
			t.Error("Expected feature flags array to be initialized (not nil)")
		}

		if len(team.FeatureFlags) != 0 {
			t.Errorf("Expected 0 feature flags, got %d", len(team.FeatureFlags))
		}
	})

	t.Run("HasFeatureFlag - empty flags array", func(t *testing.T) {
		hasFlag, err := HasFeatureFlag(ctx, emptyTeamID, "any_flag")
		if err != nil {
			t.Fatalf("HasFeatureFlag failed: %v", err)
		}

		if hasFlag {
			t.Error("Expected false when team has empty feature flags")
		}
	})
}

// setupTestTeamWithFlags creates a test team with specified feature flags
func setupTestTeamWithFlags(t *testing.T, flags []string) string {
	t.Helper()

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	ctx := context.Background()

	// Generate unique team ID for test
	teamID := "test-team-" + time.Now().Format("20060102-150405") + "-" + t.Name()
	teamName := "Test Team for " + t.Name()

	// Insert test team
	insertTeamQuery := `
		INSERT INTO securebuild_team (id, name, created_at, full_catalog_access, feature_flags)
		VALUES ($1, $2, $3, $4, $5)
	`

	_, err := conn.Exec(ctx, insertTeamQuery,
		teamID,
		teamName,
		time.Now(),
		false,
		pq.Array(flags),
	)
	if err != nil {
		t.Fatalf("Failed to create test team: %v", err)
	}

	t.Logf("Created test team %s with flags %v", teamID, flags)
	return teamID
}

// cleanupTestTeamIntegration removes test team data
func cleanupTestTeamIntegration(t *testing.T, teamID string) {
	t.Helper()

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	ctx := context.Background()

	// Delete test team
	deleteQuery := `DELETE FROM securebuild_team WHERE id = $1`

	_, err := conn.Exec(ctx, deleteQuery, teamID)
	if err != nil {
		t.Logf("Warning: Failed to cleanup test team %s: %v", teamID, err)
	} else {
		t.Logf("Cleaned up test team %s", teamID)
	}
}

// BenchmarkTeamFeatureFlags benchmarks feature flag operations
func BenchmarkTeamFeatureFlags(b *testing.B) {
	ctx := context.Background()

	// Setup test team - create a helper function that accepts testing.TB interface
	testTeamID := setupTestTeamWithFlagsTB(b, []string{"bench_flag1", "bench_flag2", "bench_flag3"})
	defer cleanupTestTeamIntegrationTB(b, testTeamID)

	b.Run("HasFeatureFlag", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, err := HasFeatureFlag(ctx, testTeamID, "bench_flag1")
			if err != nil {
				b.Fatalf("HasFeatureFlag failed: %v", err)
			}
		}
	})

	b.Run("GetTeamWithFeatureFlags", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, err := GetTeamWithFeatureFlags(ctx, testTeamID)
			if err != nil {
				b.Fatalf("GetTeamWithFeatureFlags failed: %v", err)
			}
		}
	})

	b.Run("UpdateTeamFeatureFlags", func(b *testing.B) {
		flags := []string{"updated_flag1", "updated_flag2"}
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			err := UpdateTeamFeatureFlags(ctx, testTeamID, flags)
			if err != nil {
				b.Fatalf("UpdateTeamFeatureFlags failed: %v", err)
			}
		}
	})
}

// setupTestTeamWithFlagsTB is a helper that accepts testing.TB interface
func setupTestTeamWithFlagsTB(tb testing.TB, flags []string) string {
	tb.Helper()

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	ctx := context.Background()

	// Generate unique team ID for test
	teamID := "test-team-" + time.Now().Format("20060102-150405") + "-" + tb.Name()
	teamName := "Test Team for " + tb.Name()

	// Insert test team
	insertTeamQuery := `
		INSERT INTO securebuild_team (id, name, created_at, full_catalog_access, feature_flags)
		VALUES ($1, $2, $3, $4, $5)
	`

	_, err := conn.Exec(ctx, insertTeamQuery,
		teamID,
		teamName,
		time.Now(),
		false,
		pq.Array(flags),
	)
	if err != nil {
		tb.Fatalf("Failed to create test team: %v", err)
	}

	tb.Logf("Created test team %s with flags %v", teamID, flags)
	return teamID
}

// cleanupTestTeamIntegrationTB removes test team data - accepts testing.TB interface
func cleanupTestTeamIntegrationTB(tb testing.TB, teamID string) {
	tb.Helper()

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	ctx := context.Background()

	// Delete test team
	deleteQuery := `DELETE FROM securebuild_team WHERE id = $1`

	_, err := conn.Exec(ctx, deleteQuery, teamID)
	if err != nil {
		tb.Logf("Warning: Failed to cleanup test team %s: %v", teamID, err)
	} else {
		tb.Logf("Cleaned up test team %s", teamID)
	}
}
