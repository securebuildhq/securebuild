package cli

import "github.com/spf13/cobra"

func BuildCmd() *cobra.Command {
	buildCmd := &cobra.Command{
		Use:   "build",
		Short: "Trigger and monitor builds",
	}

	buildCmd.PersistentFlags().String("api-endpoint", "https://securebuild.com", "Base URL of the securebuild API")
	buildCmd.PersistentFlags().String("api-token", "", "System service account token (required)")

	buildCmd.AddCommand(BuildPackageCmd())
	buildCmd.AddCommand(BuildImageCmd())

	return buildCmd
}
