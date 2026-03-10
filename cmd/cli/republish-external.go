package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os/signal"
	"syscall"

	"github.com/securebuildhq/securebuild/pkg/image"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"go.uber.org/zap"
)

func RepublishImageToExternalRegistryCmd() *cobra.Command {
	var name string

	cmd := &cobra.Command{
		Use:   "republish-image-to-external-registry",
		Short: "Republish an image to an external registry",
		PreRunE: func(cmd *cobra.Command, args []string) error {
			v := viper.GetViper()
			if err := v.BindPFlags(cmd.Flags()); err != nil {
				return fmt.Errorf("failed to bind flags: %w", err)
			}

			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx, err := param.Init(param.InitSourceDoppler, nil)
			if err != nil {
				return fmt.Errorf("failed to initialize params: %w", err)
			}

			logger.SetLevel(param.GetParam(ctx).LogLevel)

			ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
			defer stop()

			return republishImageToExternalRegistry(ctx, name)
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "name of the image to republish")

	return cmd
}

func republishImageToExternalRegistry(ctx context.Context, name string) error {
	logger.Debug("republishing image to external registry", zap.String("name", name))

	if err := persistence.InitPostgres(ctx); err != nil {
		return fmt.Errorf("failed to initialize postgres connection: %w", err)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id from image where name = $1`
	row := conn.QueryRow(ctx, query, name)
	var imageID string
	if err := row.Scan(&imageID); err != nil {
		return fmt.Errorf("failed to scan image: %w", err)
	}

	query = `select id from image_catalog where image_id = $1 and is_published = true`
	rows, err := conn.Query(ctx, query, imageID)
	if err != nil {
		return fmt.Errorf("failed to query image catalog: %w", err)
	}
	defer rows.Close()

	imageCatalogIDs := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("failed to scan image catalog: %w", err)
		}
		imageCatalogIDs = append(imageCatalogIDs, id)
	}

	if len(imageCatalogIDs) == 0 {
		return fmt.Errorf("no image catalog found for name: %s", name)
	}

	externalRegistries, err := image.ListImageExternalRegistries(ctx, imageID)
	if err != nil {
		return fmt.Errorf("failed to list image external registries: %w", err)
	}

	externalRegistryIDs := []string{}
	for _, externalRegistry := range externalRegistries {
		externalRegistryIDs = append(externalRegistryIDs, externalRegistry.ID)
	}

	p := listener.PushImageToExternalRegistryPayload{
		ImageCatalogIDs: imageCatalogIDs,
		RegistryIDs:     externalRegistryIDs,
	}

	payload, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	if err := persistence.EnqueueWork(ctx, "push_image_to_external_registry", string(payload)); err != nil {
		return fmt.Errorf("failed to enqueue push image to external registry: %w", err)
	}

	return nil
}
