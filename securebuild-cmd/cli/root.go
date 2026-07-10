package cli

import "github.com/spf13/cobra"

func RootCmd() *cobra.Command {
	rootCmd := &cobra.Command{
		Use:           "securebuild",
		Short:         "SecureBuild CLI client",
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	rootCmd.PersistentFlags().Bool("debug", false, "Print API requests and responses (auth token redacted)")
	rootCmd.AddCommand(BuildCmd())
	return rootCmd
}
