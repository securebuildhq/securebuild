package cli

import (
	"fmt"
	"os"

	"github.com/securebuildhq/securebuild/pkg/image/types"
)

// WriteStatus writes the build status to the specified status file
func WriteStatus(statusFile string, status types.ImageBuildStatus) error {
	if err := os.WriteFile(statusFile, []byte(status), 0o644); err != nil {
		return fmt.Errorf("failed to write status file: %w", err)
	}
	return nil
}
