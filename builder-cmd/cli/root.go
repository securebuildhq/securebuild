package cli

import "github.com/spf13/cobra"

func RootCmd() *cobra.Command {
	rootCmd := cobra.Command{
		Use:           "securebuild-builder",
		Short:         "SecureBuild Builder process",
		Long:          `SecureBuild Builder process that handles building packages and images`,
		SilenceErrors: true, // Prevent Cobra from printing errors to stderr
		SilenceUsage:  true, // Prevent Cobra from printing usage when errors occur
	}

	rootCmd.AddCommand(BuildCmd())
	rootCmd.AddCommand(BuildImageCmd())
	rootCmd.AddCommand(SetupCmd())

	return &rootCmd
}
