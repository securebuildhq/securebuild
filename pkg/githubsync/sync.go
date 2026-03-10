package githubsync

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/securebuildhq/securebuild/pkg/logger"
	pkgmodule "github.com/securebuildhq/securebuild/pkg/package"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

// syncMutex prevents concurrent GitHub sync operations
var syncMutex sync.Mutex

// PerformSync performs a full sync to GitHub:
// - Ensures repo is cloned and up to date
// - Writes all package and image files
// - Commits and pushes if there are changes
//
// This function is safe for concurrent calls; only one sync will run at a time.
func PerformSync(ctx context.Context) error {
	// Acquire the mutex to ensure only one sync runs at a time
	syncMutex.Lock()
	defer syncMutex.Unlock()

	if !isEnabled(ctx) {
		logger.Info("GitHub specs sync is disabled")
		return nil
	}

	logger.Info("starting GitHub specs sync")

	branch := getConfiguredBranch(ctx)
	if branch == "" {
		return fmt.Errorf("GitHub specs sync branch is not configured")
	}

	repoDir := getRepoDir()

	// Ensure repository is cloned and up to date
	if err := ensureRepoReady(ctx, repoDir, branch); err != nil {
		return fmt.Errorf("failed to prepare repository: %w", err)
	}

	// Get all package versions
	packages, err := getLatestPackageVersions(ctx)
	if err != nil {
		return fmt.Errorf("failed to get package versions: %w", err)
	}
	logger.Info("retrieved package versions", zap.Int("count", len(packages)))

	// Get all image APKO versions
	images, err := getImageAPKOVersions(ctx)
	if err != nil {
		return fmt.Errorf("failed to get image APKO versions: %w", err)
	}

	// Clean up existing packages, images, and pipelines directories before writing
	packagesDir := filepath.Join(repoDir, "packages")
	imagesDir := filepath.Join(repoDir, "images")
	pipelinesDir := filepath.Join(repoDir, "pipelines")

	if err := os.RemoveAll(packagesDir); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove packages directory: %w", err)
	}
	if err := os.RemoveAll(imagesDir); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove images directory: %w", err)
	}
	if err := os.RemoveAll(pipelinesDir); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove pipelines directory: %w", err)
	}
	logger.Debug("cleaned up existing packages, images, and pipelines directories prior to writing")

	// Write all files to the repository
	if err := writeAllFiles(ctx, repoDir, packages, images); err != nil {
		return fmt.Errorf("failed to write files: %w", err)
	}

	// Copy pipeline files from persistent directory to GitHub repo
	// Pipelines are already synced by the pipeline_sync listener
	if err := copyPipelinesToRepo(ctx, repoDir); err != nil {
		return fmt.Errorf("failed to copy pipelines to repository: %w", err)
	}

	// Check if there are any changes
	hasChanges, err := gitHasChanges(repoDir)
	if err != nil {
		return fmt.Errorf("failed to check for changes: %w", err)
	}

	if !hasChanges {
		logger.Info("no changes detected, skipping commit and push")
		return nil
	}

	// Commit all changes
	commitMessage := "sync: update package, image, and pipeline specifications"
	if err := gitCommitAll(repoDir, commitMessage); err != nil {
		return fmt.Errorf("failed to commit changes: %w", err)
	}

	// Push to remote
	if err := gitPush(repoDir, branch); err != nil {
		return fmt.Errorf("failed to push changes: %w", err)
	}

	logger.Info("GitHub specs sync completed successfully")
	return nil
}

// getRepoDir returns the persistent directory for the cloned repository
func getRepoDir() string {
	// Use a persistent directory in /tmp that survives across syncs
	return "/tmp/securebuild-github-sync-repo"
}

// ensureRepoReady ensures the repository is cloned and up to date with remote
// If repo exists, it does a hard reset and pull. If not, it clones.
func ensureRepoReady(ctx context.Context, repoDir, branch string) error {
	cfg := param.GetParam(ctx)
	token := cfg.SpecSyncToken

	if token == "" {
		return fmt.Errorf("GitHub specs sync configuration is incomplete, need SPECSYNC_GITHUB_TOKEN")
	}

	// Hardcoded to securebuildhq/securebuild-specs
	const org = "securebuildhq"
	const repo = "securebuild-specs"

	// Construct the URL with token authentication
	url := fmt.Sprintf("https://%s@github.com/%s/%s.git", token, org, repo)

	// Check if repo directory exists and has .git
	gitDir := filepath.Join(repoDir, ".git")
	_, err := os.Stat(gitDir)
	repoExists := err == nil

	if repoExists {
		logger.Info("repository exists, updating with git pull", zap.String("path", repoDir))

		// Hard reset to remote state (discards any local changes)
		if err := gitForcePull(ctx, repoDir, branch, url); err != nil {
			logger.Warn("failed to pull, attempting fresh clone", zap.Error(err))
			// If pull fails, remove directory and clone fresh
			if err := os.RemoveAll(repoDir); err != nil {
				return fmt.Errorf("failed to remove corrupted repo: %w", err)
			}
			return cloneRepo(ctx, repoDir, branch, url)
		}
	} else {
		logger.Info("repository not found, cloning", zap.String("path", repoDir))
		return cloneRepo(ctx, repoDir, branch, url)
	}

	return nil
}

// cloneRepo clones the configured GitHub repository
func cloneRepo(ctx context.Context, dir, branch, url string) error {
	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return fmt.Errorf("failed to create parent directory: %w", err)
	}

	cmd := exec.CommandContext(ctx, "git", "clone", "--branch", branch, url, dir)
	var stderr strings.Builder
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git clone failed: %w, stderr: %s", err, stderr.String())
	}

	logger.Info("repository cloned successfully", zap.String("branch", branch))
	return nil
}

// gitForcePull performs a hard reset and pull to force sync with remote
func gitForcePull(ctx context.Context, repoDir, branch, url string) error {
	// Fetch latest from remote
	fetchCmd := exec.CommandContext(ctx, "git", "-C", repoDir, "fetch", "origin", branch)
	var fetchStderr strings.Builder
	fetchCmd.Stderr = &fetchStderr
	if err := fetchCmd.Run(); err != nil {
		return fmt.Errorf("git fetch failed: %w, stderr: %s", err, fetchStderr.String())
	}

	// Hard reset to remote branch (discards all local changes)
	resetCmd := exec.CommandContext(ctx, "git", "-C", repoDir, "reset", "--hard", fmt.Sprintf("origin/%s", branch))
	var resetStderr strings.Builder
	resetCmd.Stderr = &resetStderr
	if err := resetCmd.Run(); err != nil {
		return fmt.Errorf("git reset failed: %w, stderr: %s", err, resetStderr.String())
	}

	// Clean untracked files and directories
	cleanCmd := exec.CommandContext(ctx, "git", "-C", repoDir, "clean", "-fd")
	var cleanStderr strings.Builder
	cleanCmd.Stderr = &cleanStderr
	if err := cleanCmd.Run(); err != nil {
		return fmt.Errorf("git clean failed: %w, stderr: %s", err, cleanStderr.String())
	}

	logger.Info("repository updated via git pull", zap.String("branch", branch))
	return nil
}

// extractFamilyName strips the version suffix from a package name to get the family name
// Examples: "bzip2-1.0.8" -> "bzip2", "postgres-15.2" -> "postgres", "linux-headers-6.6" -> "linux-headers"
// It finds the last dash that's followed by a digit (version number)
func extractFamilyName(packageName string) string {
	// Find the last dash followed by a digit (version start)
	lastVersionDash := -1
	for i := len(packageName) - 1; i >= 0; i-- {
		if packageName[i] == '-' {
			// Check if next character is a digit (start of version)
			if i+1 < len(packageName) && packageName[i+1] >= '0' && packageName[i+1] <= '9' {
				lastVersionDash = i
				break
			}
		}
	}

	if lastVersionDash != -1 {
		return packageName[:lastVersionDash]
	}

	return packageName
}

// getLatestPackageVersions retrieves the latest revision (highest apk_release)
// for each package version
func getLatestPackageVersions(ctx context.Context) ([]PackageVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		WITH ranked_versions AS (
			SELECT
				pv.id,
				p.name,
				pv.version,
				pv.melange_yaml,
				pv.updated_at,
				COALESCE(pv.apk_release, 0) as epoch,
				ROW_NUMBER() OVER (
					PARTITION BY p.name, pv.version
					ORDER BY COALESCE(pv.apk_release, 0) DESC, pv.updated_at DESC
				) as rn
			FROM package_version pv
			JOIN package p ON pv.package_id = p.id
			WHERE pv.melange_yaml IS NOT NULL
		)
		SELECT id, name, version, melange_yaml, updated_at, epoch
		FROM ranked_versions
		WHERE rn = 1
	`

	rows, err := conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query package versions: %w", err)
	}
	defer rows.Close()

	var packages []PackageVersion
	for rows.Next() {
		var pkg PackageVersion
		if err := rows.Scan(&pkg.ID, &pkg.PackageName, &pkg.Version, &pkg.MelangeYaml, &pkg.UpdatedAt, &pkg.Epoch); err != nil {
			return nil, fmt.Errorf("failed to scan package version: %w", err)
		}
		// Extract family name by stripping version from package name
		pkg.FamilyName = extractFamilyName(pkg.PackageName)
		packages = append(packages, pkg)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating package versions: %w", err)
	}

	logger.Info("retrieved latest package versions from database", zap.Int("count", len(packages)))

	return packages, nil
}

// selectMostSpecificTag picks the tag with the most dot-separated components.
// When multiple tags have the same number of dots, prefers the one that appears later in the array.
func selectMostSpecificTag(tags []string) string {
	if len(tags) == 0 {
		return ""
	}

	bestTag := tags[0]
	maxDots := strings.Count(bestTag, ".")

	for _, tag := range tags[1:] {
		dots := strings.Count(tag, ".")
		if dots >= maxDots {
			maxDots = dots
			bestTag = tag
		}
	}

	return bestTag
}

// getImageAPKOVersions retrieves the most recently updated non-null apko_yaml
// from each id along with the image name and tags.
func getImageAPKOVersions(ctx context.Context) ([]ImageAPKOVersion, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT
			iv.id,
			i.name,
			ia.tags,
			iv.apko_yaml,
			COALESCE(it.yaml_content, '') AS test_yaml
		FROM
			image_apko_version iv
			JOIN image_apko ia ON iv.image_apko_id = ia.id
			JOIN image i ON ia.image_id = i.id
			LEFT JOIN image_test it ON it.apko_id = ia.id AND it.apko_version_id = iv.id
		WHERE
			iv.updated_at = (
				SELECT MAX(updated_at) FROM image_apko_version
				WHERE image_apko_id = iv.image_apko_id
			)
			AND iv.apko_yaml IS NOT NULL
	`

	rows, err := conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query image APKO versions: %w", err)
	}
	defer rows.Close()

	var images []ImageAPKOVersion
	for rows.Next() {
		var img ImageAPKOVersion
		var tags []string
		if err := rows.Scan(&img.ID, &img.ImageName, &tags, &img.APKOYAML, &img.TestYAML); err != nil {
			return nil, fmt.Errorf("failed to scan image APKO version: %w", err)
		}

		img.Tag = selectMostSpecificTag(tags)
		images = append(images, img)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating image APKO versions: %w", err)
	}

	logger.Info("retrieved latest APKO versions from database", zap.Int("count", len(images)))

	return images, nil
}

// getAdditionalFilesForPackageVersion retrieves additional files for a package version
func getAdditionalFilesForPackageVersion(ctx context.Context, pkgVersionID string) ([]AdditionalFile, error) {
	files, err := pkgmodule.ListPackageVersionAdditionalFiles(ctx, pkgVersionID)
	if err != nil {
		return nil, fmt.Errorf("failed to list additional files: %w", err)
	}

	var additionalFiles []AdditionalFile
	for _, f := range files {
		// Extract filename from path
		filename := filepath.Base(f.Path)
		if filename == "" || filename == "." {
			filename = f.Path
		}

		additionalFiles = append(additionalFiles, AdditionalFile{
			Filename: filename,
			Content:  f.Content,
		})
	}

	return additionalFiles, nil
}

// writeAllFiles writes all package and image files to the repository
func writeAllFiles(ctx context.Context, repoDir string, packages []PackageVersion, images []ImageAPKOVersion) error {
	// Write package files (already filtered to latest revision per version in SQL query)
	for _, pkg := range packages {
		// Generate the file entry for melange.yaml
		fileEntry, err := generatePackageFile(pkg)
		if err != nil {
			logger.Error(fmt.Errorf("failed to generate package file for %s: %w", pkg.PackageName, err))
			return fmt.Errorf("failed to generate package file for %s: %w", pkg.PackageName, err)
		}

		// Write melange.yaml
		fullPath := filepath.Join(repoDir, fileEntry.Path)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			return fmt.Errorf("failed to create directory for %s: %w", fileEntry.Path, err)
		}
		if err := os.WriteFile(fullPath, []byte(fileEntry.Content), 0o644); err != nil {
			return fmt.Errorf("failed to write file %s: %w", fileEntry.Path, err)
		}

		// Get and write additional files for this package version
		additionalFiles, err := getAdditionalFilesForPackageVersion(ctx, pkg.ID)
		if err != nil {
			logger.Error(fmt.Errorf("failed to get additional files for %s: %w", pkg.PackageName, err))
			return fmt.Errorf("failed to get additional files for %s: %w", pkg.PackageName, err)
		}

		for _, addFile := range additionalFiles {
			addFileEntry, err := generatePackageAdditionalFile(pkg, addFile.Filename, addFile.Content)
			if err != nil {
				logger.Error(fmt.Errorf("failed to generate additional file for %s: %w", pkg.FamilyName, err))
				return fmt.Errorf("failed to generate additional file for %s: %w", pkg.FamilyName, err)
			}

			// Validate path is not empty (would write to repo root)
			if addFileEntry.Path == "" {
				logger.Error(fmt.Errorf("additional file path is empty for %s/%s", pkg.FamilyName, addFile.Filename))
				return fmt.Errorf("additional file path is empty for %s/%s", pkg.FamilyName, addFile.Filename)
			}

			addFullPath := filepath.Join(repoDir, addFileEntry.Path)
			if err := os.MkdirAll(filepath.Dir(addFullPath), 0o755); err != nil {
				return fmt.Errorf("failed to create directory for additional file %s: %w", addFileEntry.Path, err)
			}
			if err := os.WriteFile(addFullPath, []byte(addFileEntry.Content), 0o644); err != nil {
				return fmt.Errorf("failed to write additional file %s: %w", addFileEntry.Path, err)
			}
		}
	}

	// Write image files
	for _, img := range images {
		apkoFile, testFile, err := generateImageFile(img)
		if err != nil {
			// Log warning and skip this image if file generation fails
			logger.Warn("skipping image due to file generation error",
				zap.String("image", img.ImageName),
				zap.String("id", img.ID),
				zap.Error(err))
			continue
		}

		// Write APKO file
		fullPath := filepath.Join(repoDir, apkoFile.Path)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			return fmt.Errorf("failed to create directory for %s: %w", apkoFile.Path, err)
		}
		if err := os.WriteFile(fullPath, []byte(apkoFile.Content), 0o644); err != nil {
			return fmt.Errorf("failed to write file %s: %w", apkoFile.Path, err)
		}

		// Write test file if it exists
		if testFile != nil {
			testFullPath := filepath.Join(repoDir, testFile.Path)
			// Directory already created above since test file shares same directory
			if err := os.WriteFile(testFullPath, []byte(testFile.Content), 0o644); err != nil {
				return fmt.Errorf("failed to write test file %s: %w", testFile.Path, err)
			}
		}
	}

	return nil
}

// copyPipelinesToRepo copies pipeline files from the persistent pipeline directory to the GitHub repository
// Pipelines are already synced to the persistent directory by the pipeline_sync listener
func copyPipelinesToRepo(ctx context.Context, repoDir string) error {
	// Get the persistent pipeline directory root
	pipelineRootDir := param.GetParam(ctx).PipelineDir
	if pipelineRootDir == "" {
		return fmt.Errorf("pipeline directory is not configured")
	}

	// Check if pipeline directory exists
	if _, err := os.Stat(pipelineRootDir); os.IsNotExist(err) {
		logger.Debug("pipeline directory does not exist, skipping pipeline sync",
			zap.String("dir", pipelineRootDir))
		return nil
	}

	// Walk the pipeline directory and copy only changed files to repo directory
	// Structure: <PIPELINE_DIR>/<pipelineType>/<category>/<name>.yaml (e.g., packages/build/autoconf.yaml)
	// Target: <repoDir>/pipelines/<pipelineType>/<category>/<name>.yaml
	return filepath.Walk(pipelineRootDir, func(srcPath string, info os.FileInfo, err error) error {
		if err != nil {
			return fmt.Errorf("error walking pipeline directory: %w", err)
		}

		// Skip the root directory
		if srcPath == pipelineRootDir {
			return nil
		}

		// Skip reserved_pipelines.txt cache file (generated dynamically, not synced to repo)
		if !info.IsDir() && info.Name() == "reserved_pipelines.txt" {
			return nil
		}

		// Get relative path from pipeline source directory
		relPath, err := filepath.Rel(pipelineRootDir, srcPath)
		if err != nil {
			return fmt.Errorf("failed to get relative path: %w", err)
		}

		// Build destination path in repo: pipelines/<category>/<name>.yaml
		destPath := filepath.Join(repoDir, "pipelines", relPath)
		if info.IsDir() {
			// Create directory in repo
			if err := os.MkdirAll(destPath, 0o755); err != nil {
				return fmt.Errorf("failed to create directory %s: %w", destPath, err)
			}
			return nil
		}

		// Ensure parent directory exists for the file
		if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
			return fmt.Errorf("failed to create parent directory for %s: %w", destPath, err)
		}

		// Read source file
		sourceContent, err := os.ReadFile(srcPath)
		if err != nil {
			return fmt.Errorf("failed to read pipeline file %s: %w", srcPath, err)
		}

		// Check if destination file exists and compare content
		destContent, err := os.ReadFile(destPath)
		if err == nil {
			// File exists, compare content
			if bytes.Equal(sourceContent, destContent) {
				// Files are identical, skip copying
				logger.Debug("pipeline file unchanged, skipping",
					zap.String("source", srcPath),
					zap.String("dest", destPath))
				return nil
			}
		}

		// File doesn't exist or content differs, copy it
		if err := os.WriteFile(destPath, sourceContent, 0o644); err != nil {
			return fmt.Errorf("failed to write pipeline file %s: %w", destPath, err)
		}

		logger.Debug("copied pipeline file",
			zap.String("source", srcPath),
			zap.String("dest", destPath))

		return nil
	})
}

// gitHasChanges checks if the repository has any uncommitted changes
func gitHasChanges(repoDir string) (bool, error) {
	cmd := exec.Command("git", "-C", repoDir, "status", "--porcelain")
	output, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("failed to run git status: %w", err)
	}

	return len(output) > 0, nil
}

// gitCommitAll stages all changes and creates a commit
func gitCommitAll(repoDir, message string) error {
	// Set git config for commits
	configCmds := [][]string{
		{"git", "-C", repoDir, "config", "user.email", "automation@securebuild.com"},
		{"git", "-C", repoDir, "config", "user.name", "SecureBuild Automation"},
	}

	for _, cmdArgs := range configCmds {
		cmd := exec.Command(cmdArgs[0], cmdArgs[1:]...)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to set git config: %w", err)
		}
	}

	// Add all changes
	addCmd := exec.Command("git", "-C", repoDir, "add", ".")
	if err := addCmd.Run(); err != nil {
		return fmt.Errorf("failed to stage changes: %w", err)
	}

	// Commit (without GPG signing for automation)
	commitCmd := exec.Command("git", "-C", repoDir, "commit", "--no-gpg-sign", "-m", message)
	var stderr strings.Builder
	commitCmd.Stderr = &stderr
	if err := commitCmd.Run(); err != nil {
		return fmt.Errorf("failed to commit changes: %w, stderr: %s", err, stderr.String())
	}

	return nil
}

// gitPush pushes changes to the remote repository
func gitPush(repoDir, branch string) error {
	cmd := exec.Command("git", "-C", repoDir, "push", "origin", branch)
	var stderr strings.Builder
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to push changes: %w, stderr: %s", err, stderr.String())
	}

	return nil
}

// getConfiguredBranch returns the configured branch or "main" as default
func getConfiguredBranch(ctx context.Context) string {
	return param.GetParam(ctx).SpecSyncBranch
}

// isEnabled returns true if GitHub sync is enabled
func isEnabled(ctx context.Context) bool {
	return param.GetParam(ctx).SpecSyncEnabled
}
