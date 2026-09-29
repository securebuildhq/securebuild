package cli

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestBackfillExternalImageFixedCountsCmdSilencesUsageForRuntimeErrors(t *testing.T) {
	backfillCmd := BackfillExternalImageFixedCountsCmd()
	backfillCmd.RunE = func(*cobra.Command, []string) error {
		return errors.New("runtime failure")
	}

	rootCmd := &cobra.Command{Use: "securebuild-worker"}
	rootCmd.AddCommand(backfillCmd)
	rootCmd.SetArgs([]string{"backfill-external-image-fixed-counts"})
	var output bytes.Buffer
	rootCmd.SetOut(&output)
	rootCmd.SetErr(&output)

	err := rootCmd.Execute()
	if err == nil || !strings.Contains(err.Error(), "runtime failure") {
		t.Fatalf("expected runtime failure, got %v", err)
	}
	if strings.Contains(output.String(), "Usage:") {
		t.Fatalf("runtime failure must not print usage:\n%s", output.String())
	}
}

func TestBackfillExternalImageFixedCountsCmdShowsUsageForInvalidTimeout(t *testing.T) {
	backfillCmd := BackfillExternalImageFixedCountsCmd()
	rootCmd := &cobra.Command{Use: "securebuild-worker"}
	rootCmd.AddCommand(backfillCmd)
	rootCmd.SetArgs([]string{"backfill-external-image-fixed-counts", "--timeout=0s"})
	var output bytes.Buffer
	rootCmd.SetOut(&output)
	rootCmd.SetErr(&output)

	err := rootCmd.Execute()
	if err == nil || !strings.Contains(err.Error(), "timeout must be positive") {
		t.Fatalf("expected timeout validation error, got %v", err)
	}
	if !strings.Contains(output.String(), "Usage:") {
		t.Fatalf("invalid timeout must print usage:\n%s", output.String())
	}
}
