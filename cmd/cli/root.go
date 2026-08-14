package cli

import "github.com/spf13/cobra"

func RootCmd() *cobra.Command {
	rootCmd := cobra.Command{
		Use:   "securebuild-worker",
		Short: "SecureBuild Worker process",
		Long:  `SecureBuild Worker process that handles background tasks`,
	}

	rootCmd.AddCommand(RunCmd())
	rootCmd.AddCommand(VersionCmd())
	rootCmd.AddCommand(OCIProxyCmd())
	rootCmd.AddCommand(APKProxyCmd())
	rootCmd.AddCommand(RebuildPackageCmd())
	rootCmd.AddCommand(ExtractBuilderCmd())
	rootCmd.AddCommand(RebuildAPKCmd())
	rootCmd.AddCommand(RebuildFailedCmd())
	rootCmd.AddCommand(RebuildDependencyGraph())
	rootCmd.AddCommand(CheckForUpdatesCmd())
	rootCmd.AddCommand(DeleteUnusedPackagesCmd())
	rootCmd.AddCommand(DeleteAPKCmd())
	rootCmd.AddCommand(BuildOrderCmd())
	rootCmd.AddCommand(MigratePackageSelectorsCmd())
	return &rootCmd
}
