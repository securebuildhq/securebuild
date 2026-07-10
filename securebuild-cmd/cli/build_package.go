package cli

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var arches = []string{"x86_64", "aarch64"}

const pollInterval = 5 * time.Second

func BuildPackageCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "package",
		Short: "Trigger and monitor a package build",
		PreRunE: func(cmd *cobra.Command, args []string) error {
			v := viper.GetViper()
			v.SetEnvPrefix("SECUREBUILD")
			v.SetEnvKeyReplacer(strings.NewReplacer("-", "_"))
			v.AutomaticEnv()
			if err := v.BindPFlags(cmd.Flags()); err != nil {
				return fmt.Errorf("failed to bind flags: %w", err)
			}
			if err := v.BindPFlags(cmd.Parent().PersistentFlags()); err != nil {
				return fmt.Errorf("failed to bind persistent flags: %w", err)
			}
			if err := v.BindPFlags(cmd.Root().PersistentFlags()); err != nil {
				return fmt.Errorf("failed to bind root flags: %w", err)
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			v := viper.GetViper()

			packageFamilyName := v.GetString("package-family-name")
			tag := v.GetString("tag")
			apiEndpoint := v.GetString("api-endpoint")
			apiToken := v.GetString("api-token")
			apkRepository := v.GetString("apk-repository")
			debug := v.GetBool("debug")

			if packageFamilyName == "" {
				return fmt.Errorf("--package-family-name is required (or set SECUREBUILD_PACKAGE_FAMILY_NAME)")
			}
			if tag == "" {
				return fmt.Errorf("--tag is required (or set SECUREBUILD_TAG)")
			}
			if apiToken == "" {
				return fmt.Errorf("--api-token is required (or set SECUREBUILD_API_TOKEN)")
			}

			ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
			defer stop()

			return runBuildPackage(ctx, packageFamilyName, tag, apiEndpoint, apiToken, apkRepository, debug)
		},
	}

	cmd.Flags().String("package-family-name", "", "Package family name (e.g. go, busybox)")
	cmd.Flags().String("tag", "", "Git tag to build (e.g. 1.24.13)")
	cmd.Flags().String("apk-repository", "https://apk.cve0.io", "Base URL of the APK repository")

	return cmd
}

func runBuildPackage(ctx context.Context, packageFamilyName, tag, apiEndpoint, apiToken, apkRepository string, debug bool) error {
	client := NewClient(apiEndpoint, apiToken, debug)

	fmt.Fprintf(os.Stderr, "Triggering package update: %s @ %s\n", packageFamilyName, tag)

	triggerResp, err := client.Trigger(ctx, TriggerRequest{
		PackageFamilyName: packageFamilyName,
		Tag:               tag,
	})
	if err != nil {
		return fmt.Errorf("failed to trigger package update: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Job queued: job_id=%s\n", triggerResp.JobID)

	packageVersionID, err := pollJobStatus(ctx, client, triggerResp.JobID)
	if err != nil {
		return err
	}

	pkgVersion, err := pollBuildStatus(ctx, client, packageVersionID)
	if err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "Verifying APK availability...\n")

	apkURLs, err := verifyAPKAvailability(ctx, client, apkRepository, pkgVersion)
	if err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "APK available:\n")
	fmt.Fprintf(os.Stderr, "  x86_64:   %s\n", apkURLs["x86_64"])
	fmt.Fprintf(os.Stderr, "  aarch64:  %s\n", apkURLs["aarch64"])

	fmt.Fprintf(os.Stderr, "Package built successfully: %s version %s\n", pkgVersion.PackageName, pkgVersion.Version)
	return nil
}

func pollJobStatus(ctx context.Context, client *Client, jobID string) (string, error) {
	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		default:
		}

		status, err := client.GetJobStatus(ctx, jobID)
		if err != nil {
			return "", fmt.Errorf("failed to get job status: %w", err)
		}

		switch status.Status {
		case "completed":
			fmt.Fprintf(os.Stderr, "Job status: completed (package_version_id=%s)\n", status.PackageVersionID)
			if status.PackageVersionID == "" {
				return "", fmt.Errorf("job completed but no package_version_id was returned")
			}
			return status.PackageVersionID, nil
		case "failed":
			fmt.Fprintf(os.Stderr, "Job status: failed\n")
			return "", fmt.Errorf("job failed: %s", status.Error)
		case "expired":
			return "", fmt.Errorf("job expired or not found")
		default:
			fmt.Fprintf(os.Stderr, "Job status: %s\n", status.Status)
		}

		if err := sleepWithContext(ctx, pollInterval); err != nil {
			return "", err
		}
	}
}

func pollBuildStatus(ctx context.Context, client *Client, packageVersionID string) (*PackageVersionResponse, error) {
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		pv, err := client.GetPackageVersion(ctx, packageVersionID)
		if err != nil {
			return nil, fmt.Errorf("failed to get package version: %w", err)
		}

		switch pv.Status {
		case "success":
			fmt.Fprintf(os.Stderr, "Build status: success\n")
			return pv, nil
		case "failed", "vm_deleted":
			fmt.Fprintf(os.Stderr, "Build status: %s\n", pv.Status)
			return nil, fmt.Errorf("build %s", pv.Status)
		case "not_found":
			return nil, fmt.Errorf("package version not found")
		default:
			fmt.Fprintf(os.Stderr, "Build status: %s\n", pv.Status)
		}

		if err := sleepWithContext(ctx, pollInterval); err != nil {
			return nil, err
		}
	}
}

func verifyAPKAvailability(ctx context.Context, client *Client, apkRepository string, pv *PackageVersionResponse) (map[string]string, error) {
	apkURLs := make(map[string]string)
	for _, arch := range arches {
		apkURLs[arch] = fmt.Sprintf("%s/%s/%s-%s-r%d.apk", apkRepository, arch, pv.PackageName, pv.Version, pv.APKRelease)
	}

	fmt.Fprintf(os.Stderr, "Checking APK index...\n")
	for _, arch := range arches {
		for {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			default:
			}

			indexed, err := client.CheckAPKInIndex(ctx, apkRepository, arch, pv.PackageName, pv.Version, pv.APKRelease)
			if err != nil {
				return nil, fmt.Errorf("failed to check APK index for %s: %w", arch, err)
			}
			if indexed {
				fmt.Fprintf(os.Stderr, "APK indexed (%s)\n", arch)
				break
			}

			if err := sleepWithContext(ctx, pollInterval); err != nil {
				return nil, err
			}
		}
	}

	fmt.Fprintf(os.Stderr, "Verifying APK files...\n")
	for _, arch := range arches {
		available, err := client.CheckAPKAvailable(ctx, apkURLs[arch])
		if err != nil {
			return nil, fmt.Errorf("failed to check APK availability for %s: %w", arch, err)
		}
		if !available {
			return nil, fmt.Errorf("APK file not found for %s: %s", arch, apkURLs[arch])
		}
		fmt.Fprintf(os.Stderr, "APK file available (%s)\n", arch)
	}

	return apkURLs, nil
}

func sleepWithContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
