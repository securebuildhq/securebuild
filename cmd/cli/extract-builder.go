package cli

import (
	"fmt"
	"strings"

	"github.com/securebuildhq/securebuild/pkg/builder"
	"github.com/spf13/cobra"
)

func ExtractBuilderCmd() *cobra.Command {
	var outputPath string
	var architecture string

	cmd := &cobra.Command{
		Use:   "extract-builder",
		Short: "Extract the embedded builder binary",
		Long:  "Extract the embedded builder binary to a specified path or temporary location",
		RunE: func(cmd *cobra.Command, args []string) error {
			// If no architecture specified, show available architectures
			if architecture == "" {
				supportedArchs := builder.GetSupportedArchitectures()
				if len(supportedArchs) == 0 {
					return fmt.Errorf("no builder binaries are embedded in this worker")
				}
				return fmt.Errorf("architecture must be specified. Available architectures: %s",
					strings.Join(supportedArchs, ", "))
			}

			// Check if the specified architecture is supported
			if !builder.IsBuilderEmbedded(architecture) {
				supportedArchs := builder.GetSupportedArchitectures()
				return fmt.Errorf("builder binary is not embedded for architecture %s. Available architectures: %s",
					architecture, strings.Join(supportedArchs, ", "))
			}

			fmt.Printf("Embedded builder binary size for %s: %d bytes\n",
				architecture, builder.GetBuilderBinarySize(architecture))

			if outputPath != "" {
				// Extract to specific path
				if err := builder.ExtractBuilderBinaryToPath(outputPath, architecture); err != nil {
					return fmt.Errorf("failed to extract builder to %s: %w", outputPath, err)
				}
				fmt.Printf("Builder binary (%s) extracted to: %s\n", architecture, outputPath)
			} else {
				// Extract to temporary location
				tempPath, err := builder.ExtractBuilderBinary(architecture)
				if err != nil {
					return fmt.Errorf("failed to extract builder to temporary location: %w", err)
				}
				fmt.Printf("Builder binary (%s) extracted to temporary location: %s\n", architecture, tempPath)
				fmt.Println("Note: You are responsible for cleaning up this temporary file")
			}

			return nil
		},
	}

	cmd.Flags().StringVarP(&outputPath, "output", "o", "", "Output path for the extracted builder binary")
	cmd.Flags().StringVarP(&architecture, "arch", "a", "", "Architecture (x86_64 or aarch64)")

	return cmd
}
