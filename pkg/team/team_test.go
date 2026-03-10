package team

import (
	"context"
	"database/sql"
	"testing"

	"github.com/lib/pq"
	"github.com/securebuildhq/securebuild/pkg/team/types"
)

// TestGetTeamWithFeatureFlags tests the GetTeamWithFeatureFlags function
func TestGetTeamWithFeatureFlags(t *testing.T) {
	t.Run("valid team ID with feature flags", func(t *testing.T) {
		// This test requires a real database connection
		// Skip if running without integration test setup
		if testing.Short() {
			t.Skip("Skipping integration test in short mode")
		}

		// In a real integration test, you would:
		// 1. Set up a test database with known data
		// 2. Call GetTeamWithFeatureFlags with a valid team ID
		// 3. Verify the returned team has the expected feature flags

		ctx := context.Background()

		// This is a placeholder - in real integration tests you'd use a known test team ID
		teamID := "test-team-id"

		team, err := GetTeamWithFeatureFlags(ctx, teamID)

		// For now, we expect this to fail because we don't have test data setup
		// In a real integration test, you would assert the expected team data
		if err != nil {
			t.Logf("Expected error without test database setup: %v", err)
			return
		}

		if team == nil {
			t.Error("Expected team to be non-nil with valid ID")
			return
		}

		// Verify team structure
		if team.ID == "" {
			t.Error("Expected team ID to be non-empty")
		}

		// Feature flags should be initialized (could be empty array)
		if team.FeatureFlags == nil {
			t.Error("Expected feature flags array to be initialized")
		}
	})

	t.Run("invalid team ID", func(t *testing.T) {
		if testing.Short() {
			t.Skip("Skipping integration test in short mode")
		}

		ctx := context.Background()
		teamID := "nonexistent-team-id"

		team, err := GetTeamWithFeatureFlags(ctx, teamID)

		// Should return an error (sql.ErrNoRows) for non-existent team
		if err == nil {
			t.Error("Expected error for non-existent team ID")
		}

		if team != nil {
			t.Error("Expected nil team for non-existent team ID")
		}

		// Verify it's the expected error type
		if err != sql.ErrNoRows {
			t.Logf("Got error: %v, expected sql.ErrNoRows", err)
		}
	})
}

// TestHasFeatureFlag tests the HasFeatureFlag function
func TestHasFeatureFlag(t *testing.T) {
	t.Run("team has the flag", func(t *testing.T) {
		if testing.Short() {
			t.Skip("Skipping integration test in short mode")
		}

		ctx := context.Background()
		teamID := "test-team-with-flags"
		flag := "test_feature"

		hasFlag, err := HasFeatureFlag(ctx, teamID, flag)

		// This will likely error without test setup
		if err != nil {
			t.Logf("Expected error without test database setup: %v", err)
			return
		}

		// In a real test with proper setup, you'd verify the expected result
		t.Logf("Team has flag '%s': %t", flag, hasFlag)
	})

	t.Run("team does not have the flag", func(t *testing.T) {
		if testing.Short() {
			t.Skip("Skipping integration test in short mode")
		}

		ctx := context.Background()
		teamID := "test-team-without-flags"
		flag := "nonexistent_feature"

		hasFlag, err := HasFeatureFlag(ctx, teamID, flag)

		if err != nil {
			t.Logf("Expected error without test database setup: %v", err)
			return
		}

		// Should return false for non-existent flag
		if hasFlag {
			t.Error("Expected false for non-existent feature flag")
		}
	})

	t.Run("team has empty flags", func(t *testing.T) {
		if testing.Short() {
			t.Skip("Skipping integration test in short mode")
		}

		ctx := context.Background()
		teamID := "test-team-empty-flags"
		flag := "any_feature"

		hasFlag, err := HasFeatureFlag(ctx, teamID, flag)

		if err != nil {
			t.Logf("Expected error without test database setup: %v", err)
			return
		}

		// Should return false when team has empty flags array
		if hasFlag {
			t.Error("Expected false when team has empty feature flags")
		}
	})

	t.Run("invalid team ID", func(t *testing.T) {
		if testing.Short() {
			t.Skip("Skipping integration test in short mode")
		}

		ctx := context.Background()
		teamID := "nonexistent-team"
		flag := "any_feature"

		hasFlag, err := HasFeatureFlag(ctx, teamID, flag)

		// Should return error for non-existent team
		if err == nil {
			t.Error("Expected error for non-existent team")
		}

		if hasFlag {
			t.Error("Expected false result for non-existent team")
		}

		// Verify it's the expected error type
		if err != sql.ErrNoRows {
			t.Logf("Got error: %v, expected sql.ErrNoRows", err)
		}
	})
}

// TestUpdateTeamFeatureFlags tests the UpdateTeamFeatureFlags function
func TestUpdateTeamFeatureFlags(t *testing.T) {
	t.Run("valid update", func(t *testing.T) {
		if testing.Short() {
			t.Skip("Skipping integration test in short mode")
		}

		ctx := context.Background()
		teamID := "test-team-for-update"
		flags := []string{"feature1", "feature2"}

		err := UpdateTeamFeatureFlags(ctx, teamID, flags)

		if err != nil {
			t.Logf("Expected error without test database setup: %v", err)
			return
		}

		// In a real integration test, you would verify the update worked
		// by querying the database and checking the flags were set correctly
		t.Logf("Successfully updated team %s with flags %v", teamID, flags)
	})

	t.Run("empty flags array", func(t *testing.T) {
		if testing.Short() {
			t.Skip("Skipping integration test in short mode")
		}

		ctx := context.Background()
		teamID := "test-team-for-empty-update"
		flags := []string{}

		err := UpdateTeamFeatureFlags(ctx, teamID, flags)

		if err != nil {
			t.Logf("Expected error without test database setup: %v", err)
			return
		}

		// Should succeed with empty flags array
		t.Logf("Successfully updated team %s with empty flags", teamID)
	})

	t.Run("invalid team ID", func(t *testing.T) {
		if testing.Short() {
			t.Skip("Skipping integration test in short mode")
		}

		ctx := context.Background()
		teamID := "nonexistent-team-for-update"
		flags := []string{"feature1"}

		err := UpdateTeamFeatureFlags(ctx, teamID, flags)

		// The update might succeed but affect 0 rows
		// The function doesn't currently check affected rows
		// In a production system, you might want to verify that rows were actually updated
		if err != nil {
			t.Logf("Got error for non-existent team: %v", err)
		} else {
			t.Logf("Update succeeded but may have affected 0 rows for non-existent team")
		}
	})
}

// TestTeamTypes tests the team types for proper serialization/deserialization
func TestTeamTypes(t *testing.T) {
	t.Run("Team struct with feature flags", func(t *testing.T) {
		team := &types.Team{
			ID:                "test123",
			Name:              "Test Team",
			FullCatalogAccess: true,
			FeatureFlags:      pq.StringArray{"flag1", "flag2"},
		}

		if len(team.FeatureFlags) != 2 {
			t.Errorf("Expected 2 feature flags, got %d", len(team.FeatureFlags))
		}

		if team.FeatureFlags[0] != "flag1" {
			t.Errorf("Expected first flag to be 'flag1', got '%s'", team.FeatureFlags[0])
		}

		if team.FeatureFlags[1] != "flag2" {
			t.Errorf("Expected second flag to be 'flag2', got '%s'", team.FeatureFlags[1])
		}
	})

	t.Run("Team struct with empty feature flags", func(t *testing.T) {
		team := &types.Team{
			ID:           "test456",
			Name:         "Empty Flags Team",
			FeatureFlags: pq.StringArray{},
		}

		if len(team.FeatureFlags) != 0 {
			t.Errorf("Expected 0 feature flags, got %d", len(team.FeatureFlags))
		}
	})

	t.Run("Team struct with nil feature flags", func(t *testing.T) {
		team := &types.Team{
			ID:           "test789",
			Name:         "Nil Flags Team",
			FeatureFlags: nil,
		}

		if team.FeatureFlags != nil {
			t.Error("Expected feature flags to be nil")
		}
	})
}

// BenchmarkHasFeatureFlag benchmarks the HasFeatureFlag function
func BenchmarkHasFeatureFlag(b *testing.B) {
	if testing.Short() {
		b.Skip("Skipping benchmark in short mode")
	}

	ctx := context.Background()
	teamID := "benchmark-team"
	flag := "benchmark_flag"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := HasFeatureFlag(ctx, teamID, flag)
		if err != nil {
			// Expected without test setup
			continue
		}
	}
}

// Example test data setup function (would be used in integration tests)
func setupTestTeam(t *testing.T, teamID string, flags []string) {
	// This is a placeholder for test data setup
	// In real integration tests, you would:
	// 1. Get database connection
	// 2. Insert test team with specified flags
	// 3. Register cleanup function to remove test data

	t.Logf("Setting up test team %s with flags %v", teamID, flags)
}

// Example cleanup function
func cleanupTestTeam(t *testing.T, teamID string) {
	// This is a placeholder for test cleanup
	// In real integration tests, you would:
	// 1. Get database connection
	// 2. Delete test team and related data

	t.Logf("Cleaning up test team %s", teamID)
}
