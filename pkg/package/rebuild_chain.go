package sbpackage

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/securebuildhq/securebuild/pkg/buildgraph"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
)

// RebuildChain represents a rebuild chain record
type RebuildChain struct {
	ID               string
	PackageID        string
	PackageVersionID *string
	CreatedAt        time.Time
	CompletedAt      *time.Time
	Error            *string
	ChainName        string
}

// RebuildChainLink represents a rebuild chain link record
type RebuildChainLink struct {
	LinkID         string
	RebuildChainID string
	PackageID      string
	ExecutionID    *string
}

// RebuildChainDependency represents a rebuild chain dependency record
type RebuildChainDependency struct {
	LinkID       string
	DependencyID string
}

// CreateRebuildChain creates a new rebuild chain with links and dependencies using BuildDAG output
func CreateRebuildChain(ctx context.Context, packageID string, packageVersionID *string, nodes []string, edges []buildgraph.Edge, chainName string) (*RebuildChain, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// Generate rebuild chain ID
	chainID, err := securerandom.Hex(32)
	if err != nil {
		return nil, fmt.Errorf("failed to generate rebuild chain ID: %w", err)
	}

	// Begin transaction
	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	now := time.Now().UTC()

	// Insert rebuild chain record
	query := `INSERT INTO rebuild_chain (id, package_id, package_version_id, created_at, chain_name) VALUES ($1, $2, $3, $4, $5)`
	_, err = tx.Exec(ctx, query, chainID, packageID, packageVersionID, now, chainName)
	if err != nil {
		return nil, fmt.Errorf("failed to insert rebuild chain: %w", err)
	}

	// Create mapping from node names (including #2 suffixes) to link IDs
	nodeToLinkID := make(map[string]string)

	// Generate unique link IDs for each node (including #2 variants)
	for _, nodeName := range nodes {
		linkID, err := securerandom.Hex(32)
		if err != nil {
			return nil, fmt.Errorf("failed to generate link ID for node %s: %w", nodeName, err)
		}
		nodeToLinkID[nodeName] = linkID
	}

	// Insert rebuild chain links for each node
	for _, nodeName := range nodes {
		linkID := nodeToLinkID[nodeName]
		// Strip #2 suffix to get the actual package name, then convert to package ID
		packageName := strings.TrimSuffix(nodeName, "#2")

		pkgID, err := GetPackageIDByName(ctx, packageName)
		if err != nil {
			if err == ErrPackageNotFound {
				return nil, fmt.Errorf("package %s not found in database", packageName)
			}
			return nil, fmt.Errorf("failed to get package ID for %s: %w", packageName, err)
		}

		query := `INSERT INTO rebuild_chain_link (link_id, rebuild_chain_id, package_id) VALUES ($1, $2, $3)`
		_, err = tx.Exec(ctx, query, linkID, chainID, pkgID)
		if err != nil {
			return nil, fmt.Errorf("failed to insert rebuild chain link for node %s (package %s): %w", nodeName, packageName, err)
		}
	}

	// Insert rebuild chain dependencies based on DAG edges
	for _, edge := range edges {
		fromLinkID, fromExists := nodeToLinkID[edge.From]
		toLinkID, toExists := nodeToLinkID[edge.To]

		if !fromExists {
			return nil, fmt.Errorf("edge references unknown node: %s", edge.From)
		}
		if !toExists {
			return nil, fmt.Errorf("edge references unknown node: %s", edge.To)
		}

		// Insert dependency: toLinkID depends on fromLinkID (To must wait for From to complete)
		query := `INSERT INTO rebuild_chain_dependency (link_id, dependency_id) VALUES ($1, $2)`
		_, err = tx.Exec(ctx, query, toLinkID, fromLinkID)
		if err != nil {
			return nil, fmt.Errorf("failed to insert rebuild chain dependency from %s to %s: %w", edge.From, edge.To, err)
		}
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	return &RebuildChain{
		ID:               chainID,
		PackageID:        packageID,
		PackageVersionID: packageVersionID,
		CreatedAt:        now,
		ChainName:        chainName,
	}, nil
}

// GetRebuildChain retrieves a rebuild chain by ID
func GetRebuildChain(ctx context.Context, chainID string) (*RebuildChain, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var chain RebuildChain
	query := `SELECT id, package_id, package_version_id, created_at, completed_at, error FROM rebuild_chain WHERE id = $1`

	err := conn.QueryRow(ctx, query, chainID).Scan(
		&chain.ID,
		&chain.PackageID,
		&chain.PackageVersionID,
		&chain.CreatedAt,
		&chain.CompletedAt,
		&chain.Error,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get rebuild chain: %w", err)
	}

	return &chain, nil
}

// UpdateRebuildChainCompletion updates the completion status of a rebuild chain
func UpdateRebuildChainCompletion(ctx context.Context, chainID string, completedAt *time.Time, errorMsg *string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `UPDATE rebuild_chain SET completed_at = $1, error = $2 WHERE id = $3`
	_, err := conn.Exec(ctx, query, completedAt, errorMsg, chainID)
	if err != nil {
		return fmt.Errorf("failed to update rebuild chain completion: %w", err)
	}

	return nil
}

// GetRebuildChainLinks retrieves all links for a rebuild chain
func GetRebuildChainLinks(ctx context.Context, chainID string) ([]RebuildChainLink, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT link_id, rebuild_chain_id, package_id, execution_id FROM rebuild_chain_link WHERE rebuild_chain_id = $1`

	rows, err := conn.Query(ctx, query, chainID)
	if err != nil {
		return nil, fmt.Errorf("failed to query rebuild chain links: %w", err)
	}
	defer rows.Close()

	var links []RebuildChainLink
	for rows.Next() {
		var link RebuildChainLink
		err := rows.Scan(&link.LinkID, &link.RebuildChainID, &link.PackageID, &link.ExecutionID)
		if err != nil {
			return nil, fmt.Errorf("failed to scan rebuild chain link: %w", err)
		}
		links = append(links, link)
	}

	return links, nil
}

// GetRebuildChainDependencies retrieves all dependencies for a rebuild chain link
func GetRebuildChainDependencies(ctx context.Context, linkID string) ([]RebuildChainDependency, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT link_id, dependency_id FROM rebuild_chain_dependency WHERE link_id = $1`

	rows, err := conn.Query(ctx, query, linkID)
	if err != nil {
		return nil, fmt.Errorf("failed to query rebuild chain dependencies: %w", err)
	}
	defer rows.Close()

	var deps []RebuildChainDependency
	for rows.Next() {
		var dep RebuildChainDependency
		err := rows.Scan(&dep.LinkID, &dep.DependencyID)
		if err != nil {
			return nil, fmt.Errorf("failed to scan rebuild chain dependency: %w", err)
		}
		deps = append(deps, dep)
	}

	return deps, nil
}
