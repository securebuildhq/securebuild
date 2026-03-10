package pipeline

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/google/go-github/v61/github"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

const (
	// Cache file name
	reservedPipelinesCache = "reserved_pipelines.txt"

	// Melange repository details
	melangeOrg    = "chainguard-dev"
	melangeRepo   = "melange"
	melangeBranch = "main"
	pipelinesPath = "pkg/build/pipelines"
)

// reservedPipelines is loaded dynamically from GitHub on init and cached
// See pkg/pipeline/reserved.go for the loading logic
var reservedPipelines = []string{}

// IsReservedPipeline checks if a path is reserved by melange
func IsReservedPipeline(path string) bool {
	return slices.Contains(reservedPipelines, path)
}

// LoadReservedPipelines fetches the reserved package pipelines list from
// GitHub on init. Should be called during application initialization
func LoadReservedPipelines(ctx context.Context, logger *zap.Logger) error {
	pipelineDir, err := GetPipelineDir(ctx, TypePackage)
	if err != nil {
		return fmt.Errorf("failed to get package pipeline directory: %w", err)
	}

	cacheFile := filepath.Join(pipelineDir, reservedPipelinesCache)

	// Fetch from GitHub
	p := param.GetParam(ctx)

	pipelines, err := fetchReservedPipelinesFromGitHub(ctx, p.SpecSyncToken)
	if err != nil {
		logger.Warn("failed to fetch reserved package pipelines from GitHub, will use cached list if available", zap.Error(err))
		pipelines, err = loadPipelinesFromCache(cacheFile)
		if err != nil {
			return fmt.Errorf("failed to load package pipelines from cache: %w", err)
		}
	}

	// Update the in-memory list
	reservedPipelines = pipelines

	// Save to cache file for TypeScript validation and future use
	if err := savePipelinesToCache(cacheFile, pipelines); err != nil {
		logger.Warn("failed to save pipelines to cache", zap.Error(err))
	}

	logger.Info("fetched and cached reserved pipelines from GitHub", zap.Int("count", len(pipelines)))
	return nil
}

// fetchReservedPipelinesFromGitHub fetches the list of reserved pipelines from
// melange's GitHub repo.  If it cannot reach GitHub we fetch the list from
// cache if it exists.
func fetchReservedPipelinesFromGitHub(ctx context.Context, token string) ([]string, error) {
	var client *github.Client

	if token == "" {
		logger.Debug("No GitHub token configured, using unauthenticated client")
		client = github.NewClient(nil)
	} else {
		// Create OAuth2 token source
		ts := oauth2.StaticTokenSource(
			&oauth2.Token{AccessToken: token},
		)
		tc := oauth2.NewClient(ctx, ts)

		// Create GitHub client
		client = github.NewClient(tc)
	}

	// Fetch the tree for the pipelines directory
	tree, _, err := client.Git.GetTree(ctx, melangeOrg, melangeRepo, melangeBranch, true)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch tree from GitHub: %w", err)
	}

	// Extract pipeline paths from the tree
	var pipelines []string
	for _, entry := range tree.Entries {
		// Only look for .yaml files in pkg/build/pipelines/
		if entry.GetType() == "blob" && strings.HasPrefix(entry.GetPath(), pipelinesPath+"/") && strings.HasSuffix(entry.GetPath(), ".yaml") {
			// Extract category/name from path
			// e.g., "pkg/build/pipelines/go/build.yaml" -> "go/build"
			// or   "pkg/build/pipelines/fetch.yaml" -> "fetch"
			relativePath := strings.TrimPrefix(entry.GetPath(), pipelinesPath+"/")
			relativePath = strings.TrimSuffix(relativePath, ".yaml")

			// Include all pipelines (both categorized like "go/build" and non-categorized like "fetch")
			pipelines = append(pipelines, relativePath)
		}
	}

	slices.Sort(pipelines)
	return pipelines, nil
}

// loadPipelinesFromCache loads the pipelines list from the cache file
func loadPipelinesFromCache(cacheFile string) ([]string, error) {
	file, err := os.Open(cacheFile)
	if err != nil {
		return nil, fmt.Errorf("failed to open cache file: %w", err)
	}
	defer file.Close()

	var pipelines []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		// Skip comments and empty lines
		if line != "" && !strings.HasPrefix(line, "#") {
			pipelines = append(pipelines, line)
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("failed to read cache file: %w", err)
	}

	if len(pipelines) == 0 {
		return nil, fmt.Errorf("cache file is empty or contains no valid pipelines")
	}

	slices.Sort(pipelines)
	return pipelines, nil
}

// savePipelinesToCache saves the pipelines list to the cache file
func savePipelinesToCache(path string, pipelines []string) error {
	var sb strings.Builder
	sb.WriteString("# Reserved melange pipelines\n")
	sb.WriteString("# Auto-generated from https://github.com/chainguard-dev/melange/tree/main/pkg/build/pipelines\n")
	sb.WriteString(fmt.Sprintf("# Generated at: %s\n\n", time.Now().UTC().Format(time.RFC3339)))

	for _, pipeline := range pipelines {
		sb.WriteString(pipeline)
		sb.WriteString("\n")
	}

	if err := os.WriteFile(path, []byte(sb.String()), 0o644); err != nil {
		return fmt.Errorf("failed to save pipelines to cache: %w", err)
	}

	return nil
}
