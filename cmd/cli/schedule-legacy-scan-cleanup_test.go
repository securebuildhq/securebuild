package cli

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestScheduleLegacyScanCleanupRejectsInvalidLimitsBeforeConnecting(t *testing.T) {
	for _, flag := range []string{"--timeout=0s", "--batch-size=0", "--batch-size=501"} {
		t.Run(flag, func(t *testing.T) {
			cmd := RootCmd()
			var output bytes.Buffer
			cmd.SetOut(&output)
			cmd.SetErr(&output)
			cmd.SetArgs([]string{"schedule-legacy-scan-cleanup", flag})
			err := cmd.Execute()
			require.Error(t, err)
			require.False(t, cmd.SilenceUsage)
			require.NotContains(t, err.Error(), "postgres")
		})
	}
}
