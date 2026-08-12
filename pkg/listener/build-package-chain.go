package listener

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/buildgraph"
	"github.com/securebuildhq/securebuild/pkg/logger"
	sbpackage "github.com/securebuildhq/securebuild/pkg/package"
	"go.uber.org/zap"
)

type BuildPackageChainPayload struct {
	PackageID        string `json:"packageId"`
	PackageVersionID string `json:"packageVersionId"`
}

func handleBuildPackageChain(ctx context.Context, payload string) error {
	logger.Debug("handling build package chain", zap.String("payload", payload))

	var buildPackageChainPayload BuildPackageChainPayload
	if err := json.Unmarshal([]byte(payload), &buildPackageChainPayload); err != nil {
		return fmt.Errorf("failed to unmarshal build package chain payload: %w", err)
	}

	// Get the package to ensure it exists
	pkg, err := sbpackage.GetPackage(ctx, buildPackageChainPayload.PackageID)
	if err != nil {
		if err == sbpackage.ErrPackageNotFound {
			logger.Warn("package not found for build package chain", zap.String("packageId", buildPackageChainPayload.PackageID))
			return nil // no need to try again
		}
		return fmt.Errorf("failed to get package: %w", err)
	}

	dependencyMap, diagnostics, err := sbpackage.GetConstraintAwarePackageDependencyMap(ctx, buildPackageChainPayload.PackageVersionID)
	if err != nil {
		return fmt.Errorf("failed to create constraint-aware dependency map: %w", err)
	}
	logger.Info("calculated constraint-aware dependency map",
		zap.Int("dependencies", diagnostics.Dependencies),
		zap.Int("pinned", diagnostics.Pinned),
		zap.Int("unpinned", diagnostics.Unpinned),
		zap.Int("unresolved", diagnostics.Unresolved),
		zap.Int("ambiguous", diagnostics.Ambiguous),
		zap.Int("missingSelectors", diagnostics.MissingSelectors),
		zap.Int("storedProviderMoves", diagnostics.StoredProviderMove))
	if diagnostics.MissingSelectors > 0 {
		logger.Warn("constraint-aware dependency graph used package-name fallback for dependencies without selectors; run migrate-package-selectors",
			zap.Int("missingSelectors", diagnostics.MissingSelectors))
	}

	// Check if package exists in the dependency map
	if _, exists := dependencyMap[pkg.Name]; !exists {
		logger.Warn("package not found in dependency map", zap.String("packageName", pkg.Name))
		// Still create a rebuild chain with just this package
		dependencyMap[pkg.Name] = []string{}
	}

	start := time.Now()
	// Get build DAG using the package name
	nodes, edges := buildgraph.BuildDAG(dependencyMap, pkg.Name)
	elapsed := time.Since(start)

	logger.Info("calculated build DAG for package chain",
		zap.String("packageName", pkg.Name),
		zap.String("packageId", pkg.ID),
		zap.Strings("nodes", nodes),
		zap.Int("nodesLength", len(nodes)),
		zap.Int("edgesLength", len(edges)),
		zap.Duration("calculationTime", elapsed))

	// Create rebuild chain with links and dependencies using the DAG structure
	rebuildChain, err := sbpackage.CreateRebuildChain(ctx, pkg.ID, &buildPackageChainPayload.PackageVersionID, nodes, edges, pkg.Name)
	if err != nil {
		return fmt.Errorf("failed to create rebuild chain: %w", err)
	}

	logger.Info("created rebuild chain",
		zap.String("rebuildChainId", rebuildChain.ID),
		zap.String("packageName", pkg.Name),
		zap.String("packageId", pkg.ID),
		zap.String("packageVersionId", buildPackageChainPayload.PackageVersionID),
		zap.Int("nodesCount", len(nodes)),
		zap.Int("edgesCount", len(edges)))

	return nil
}
