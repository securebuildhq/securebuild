package cli

import (
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/buildversion"
	"github.com/spf13/cobra"
)

func VersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print version, git SHA, and build time",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("version: %s\n", buildversion.Version())
			fmt.Printf("git SHA: %s\n", buildversion.GitSHA())
			fmt.Printf("build time: %s\n", buildversion.BuildTime())
			return nil
		},
	}
}
