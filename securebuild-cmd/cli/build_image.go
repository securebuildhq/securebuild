package cli

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func BuildImageCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "image",
		Short: "Trigger and monitor an image build",
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

			imageName := v.GetString("image-name")
			tag := v.GetString("tag")
			imageTags := v.GetStringSlice("image-tag")
			apiEndpoint := v.GetString("api-endpoint")
			apiToken := v.GetString("api-token")
			debug := v.GetBool("debug")

			if imageName == "" {
				return fmt.Errorf("--image-name is required (or set SECUREBUILD_IMAGE_NAME)")
			}
			if tag == "" {
				return fmt.Errorf("--tag is required (or set SECUREBUILD_TAG)")
			}
			if apiToken == "" {
				return fmt.Errorf("--api-token is required (or set SECUREBUILD_API_TOKEN)")
			}

			ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
			defer stop()

			return runBuildImage(ctx, imageName, tag, imageTags, apiEndpoint, apiToken, debug)
		},
	}

	cmd.Flags().String("image-name", "", "Image name (e.g. go, busybox)")
	cmd.Flags().String("tag", "", "Git tag to build (e.g. 1.24.13)")
	cmd.Flags().StringSlice("image-tag", nil, "Additional image tag to apply (may be repeated)")

	return cmd
}

func runBuildImage(ctx context.Context, imageName, tag string, imageTags []string, apiEndpoint, apiToken string, debug bool) error {
	client := NewClient(apiEndpoint, apiToken, debug)

	fmt.Fprintf(os.Stderr, "Triggering image update: %s @ %s\n", imageName, tag)

	triggerResp, err := client.TriggerImage(ctx, ImageTriggerRequest{
		ImageName: imageName,
		Tag:       tag,
		ImageTags: imageTags,
	})
	if err != nil {
		return fmt.Errorf("failed to trigger image update: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Job queued: job_id=%s\n", triggerResp.JobID)

	imageBuildID, err := pollJobStatus(ctx, client, triggerResp.JobID, "image_build_id")
	if err != nil {
		return err
	}

	imageBuild, err := pollImageBuildStatus(ctx, client, imageBuildID)
	if err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "Image built successfully: %s (tags: %s)\n", imageBuild.ImageName, strings.Join(imageBuild.Tags, ", "))
	return nil
}

func pollImageBuildStatus(ctx context.Context, client *Client, imageBuildID string) (*ImageBuildResponse, error) {
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		ib, err := client.GetImageBuild(ctx, imageBuildID)
		if err != nil {
			return nil, fmt.Errorf("failed to get image build: %w", err)
		}

		switch ib.Status {
		case "success":
			fmt.Fprintf(os.Stderr, "Build status: success\n")
			return ib, nil
		case "failed", "timed_out":
			fmt.Fprintf(os.Stderr, "Build status: %s\n", ib.Status)
			return nil, fmt.Errorf("build %s: %s", ib.Status, ib.Error)
		case "not_found":
			return nil, fmt.Errorf("image build not found")
		default:
			fmt.Fprintf(os.Stderr, "Build status: %s\n", ib.Status)
		}

		if err := sleepWithContext(ctx, pollInterval); err != nil {
			return nil, err
		}
	}
}
