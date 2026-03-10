package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/signal"
	"syscall"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/spf13/cobra"
	"go.uber.org/zap"
)

type RebuildPackageRequest struct {
	PackageName string `json:"packageName"`
}

type RebuildPackageResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

func RebuildPackageCmd() *cobra.Command {
	var apiEndpoint string

	rebuildPackageCmd := cobra.Command{
		Use:   "rebuild-package [package-name]",
		Short: "Rebuild a package",
		Long:  `Rebuild a package by triggering a rebuild via the API`,
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
			defer stop()

			packageName := args[0]
			if err := runRebuildPackage(ctx, apiEndpoint, packageName); err != nil {
				return fmt.Errorf("rebuild package error: %w", err)
			}
			return nil
		},
	}

	rebuildPackageCmd.Flags().StringVar(&apiEndpoint, "api-endpoint", "http://localhost:3000", "API endpoint for the securebuild service")

	return &rebuildPackageCmd
}

func runRebuildPackage(ctx context.Context, apiEndpoint string, packageName string) error {
	logger.Info("Starting rebuild package process",
		zap.String("api_endpoint", apiEndpoint),
		zap.String("package_name", packageName))

	request := RebuildPackageRequest{
		PackageName: packageName,
	}

	jsonRequest, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiEndpoint+"/api/rebuild-packages", bytes.NewBuffer(jsonRequest))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API returned status code: %d", resp.StatusCode)
	}

	var response RebuildPackageResponse
	err = json.NewDecoder(resp.Body).Decode(&response)
	if err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	if !response.Success {
		return fmt.Errorf("API returned error: %s", response.Error)
	}

	logger.Info("Package rebuild triggered successfully", zap.String("package_name", packageName))
	return nil
}
