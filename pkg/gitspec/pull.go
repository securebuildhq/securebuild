package gitspec

import (
	"context"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/google/go-github/v61/github"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

// SpecContent holds the content pulled from a git repo at a specific tag.
type SpecContent struct {
	Content    string
	CommitSHA  string
	AdditionalFiles []AdditionalFile
}

// AdditionalFile represents a file found in the same directory as a spec file.
type AdditionalFile struct {
	Path    string // relative path from the spec file's directory
	Content string
}

// PullSpecFromGit fetches the spec file and additional files from a GitHub repo at a specific tag
// using the GitHub API. Returns the file content, the commit SHA for the tag, and additional files
// from the same directory (recursively).
func PullSpecFromGit(ctx context.Context, client *github.Client, gitRemote, filePath, tag string) (*SpecContent, error) {
	owner, repo, err := parseOwnerRepo(gitRemote)
	if err != nil {
		return nil, err
	}

	commitSHA, err := ResolveTagToCommit(ctx, client, gitRemote, tag)
	if err != nil {
		return nil, fmt.Errorf("resolve tag to commit: %w", err)
	}

	// Get the spec file content at the tag
	specContent, err := getFileContent(ctx, client, owner, repo, filePath, commitSHA)
	if err != nil {
		return nil, fmt.Errorf("read spec file %s: %w", filePath, err)
	}

	// Get the directory contents recursively to find additional files
	specDir := filepath.Dir(filePath)
	specFileName := filepath.Base(filePath)
	additionalFiles, err := getAdditionalFilesFromGitHub(ctx, client, owner, repo, specDir, specFileName, commitSHA)
	if err != nil {
		return nil, fmt.Errorf("collect additional files: %w", err)
	}

	logger.Info("pulled spec from git",
		zap.String("git_remote", gitRemote),
		zap.String("file_path", filePath),
		zap.String("tag", tag),
		zap.String("commit_sha", commitSHA),
		zap.Int("additional_files", len(additionalFiles)))

	return &SpecContent{
		Content:         specContent,
		CommitSHA:       commitSHA,
		AdditionalFiles: additionalFiles,
	}, nil
}

// getFileContent fetches a single file's content from a GitHub repo at a specific ref.
func getFileContent(ctx context.Context, client *github.Client, owner, repo, path, ref string) (string, error) {
	opt := &github.RepositoryContentGetOptions{Ref: ref}
	fileContent, _, _, err := client.Repositories.GetContents(ctx, owner, repo, path, opt)
	if err != nil {
		return "", fmt.Errorf("get contents for %s at ref %s: %w", path, ref, err)
	}
	if fileContent == nil {
		return "", fmt.Errorf("file %s not found at ref %s", path, ref)
	}
	content, err := fileContent.GetContent()
	if err != nil {
		return "", fmt.Errorf("decode content for %s: %w", path, err)
	}
	return content, nil
}

// getAdditionalFilesFromGitHub fetches all files in a directory (recursively) from a GitHub repo,
// excluding the spec file itself. Uses the Git Trees API with recursive=true for efficiency.
func getAdditionalFilesFromGitHub(ctx context.Context, client *github.Client, owner, repo, dir, specFileName, ref string) ([]AdditionalFile, error) {
	// Use the Git Trees API to get a recursive listing of the directory
	tree, _, err := client.Git.GetTree(ctx, owner, repo, ref, true)
	if err != nil {
		return nil, fmt.Errorf("get tree at ref %s: %w", ref, err)
	}

	var files []AdditionalFile
	for _, entry := range tree.Entries {
		if entry.GetType() != "blob" {
			continue
		}
		entryPath := entry.GetPath()

		// Only include files under the spec file's directory
		if !strings.HasPrefix(entryPath, dir+"/") && entryPath != dir {
			continue
		}

		// Calculate path relative to the spec directory
		var relPath string
		if dir == "." || dir == "" {
			relPath = entryPath
		} else {
			relPath = strings.TrimPrefix(entryPath, dir+"/")
		}

		// Skip the spec file itself
		if relPath == specFileName {
			continue
		}

		if relPath == "" || relPath == "." {
			continue
		}

		content, err := getFileContent(ctx, client, owner, repo, entryPath, ref)
		if err != nil {
			logger.Warn("failed to get additional file content, skipping",
				zap.String("path", entryPath),
				zap.Error(err))
			continue
		}

		files = append(files, AdditionalFile{
			Path:    relPath,
			Content: content,
		})
	}

	return files, nil
}

// parseOwnerRepo extracts the owner and repo from a GitHub URL.
// Handles formats like "https://github.com/owner/repo.git" or "github.com/owner/repo".
func parseOwnerRepo(gitRemote string) (string, string, error) {
	parsedURL, err := url.Parse(gitRemote)
	if err != nil {
		return "", "", fmt.Errorf("invalid repository URL: %w", err)
	}

	pathParts := strings.Split(strings.Trim(parsedURL.Path, "/"), "/")
	if len(pathParts) < 2 {
		return "", "", fmt.Errorf("invalid repository path, expected format: github.com/owner/repo, got: %s", gitRemote)
	}

	owner := pathParts[0]
	repo := strings.TrimSuffix(pathParts[1], ".git")
	return owner, repo, nil
}

// ListTags lists all tags from a GitHub repo using the GitHub API.
func ListTags(ctx context.Context, client *github.Client, gitRemote string) ([]string, error) {
	owner, repo, err := parseOwnerRepo(gitRemote)
	if err != nil {
		return nil, err
	}

	var allTags []string
	opt := &github.ListOptions{PerPage: 100}
	for {
		tags, resp, err := client.Repositories.ListTags(ctx, owner, repo, opt)
		if err != nil {
			return nil, fmt.Errorf("failed to list tags for %s/%s: %w", owner, repo, err)
		}
		for _, tag := range tags {
			allTags = append(allTags, tag.GetName())
		}
		if resp.NextPage == 0 {
			break
		}
		opt.Page = resp.NextPage
	}

	return allTags, nil
}

// ResolveTagToCommit resolves a git tag to its commit SHA using the GitHub API.
func ResolveTagToCommit(ctx context.Context, client *github.Client, gitRemote, tag string) (string, error) {
	owner, repo, err := parseOwnerRepo(gitRemote)
	if err != nil {
		return "", err
	}

	ref, _, err := client.Git.GetRef(ctx, owner, repo, "refs/tags/"+tag)
	if err != nil {
		return "", fmt.Errorf("failed to get ref for tag %s: %w", tag, err)
	}

	obj := ref.GetObject()

	if obj.GetType() == "commit" {
		return obj.GetSHA(), nil
	} else if obj.GetType() == "tag" {
		tagObj, _, err := client.Git.GetTag(ctx, owner, repo, obj.GetSHA())
		if err != nil {
			return "", fmt.Errorf("failed to get tag object: %w", err)
		}
		return tagObj.GetObject().GetSHA(), nil
	}

	return "", fmt.Errorf("unexpected object type: %s", obj.GetType())
}
