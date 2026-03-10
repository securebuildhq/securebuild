package updater

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/Masterminds/semver"
	"github.com/google/go-github/v61/github"
)

type GitHubMonitorConfig struct {
	Identifier        string
	StripPrefix       string
	StripSuffix       string
	TagFilter         string
	TagFilterPrefix   string
	TagFilterContains string
	UseTags           bool
	CurrentMajor      *int
	CurrentMinor      *int
}

type GitHubVersionResult struct {
	Version string
	Commit  string
}

func FetchLatestSemverTag(ctx context.Context, client *github.Client, cfg GitHubMonitorConfig) (*GitHubVersionResult, error) {
	identifier := strings.Split(cfg.Identifier, "/")
	if len(identifier) != 2 {
		return nil, fmt.Errorf("invalid github identifier: %q", cfg.Identifier)
	}
	owner := identifier[0]
	repo := identifier[1]

	var allTags []*github.RepositoryTag
	opt := &github.ListOptions{PerPage: 100}
	for {
		tags, resp, err := client.Repositories.ListTags(ctx, owner, repo, opt)
		if err != nil {
			return nil, fmt.Errorf("failed to list tags: %w", err)
		}
		allTags = append(allTags, tags...)
		if resp.NextPage == 0 {
			break
		}
		opt.Page = resp.NextPage
	}

	var candidates []struct {
		Tag      string
		Stripped string
		SHA      string
		Semver   *semver.Version
	}

	for _, tag := range allTags {
		rawTag := tag.GetName()

		if cfg.TagFilter != "" && !strings.Contains(rawTag, cfg.TagFilter) {
			continue
		}
		if cfg.TagFilterPrefix != "" && !strings.HasPrefix(rawTag, cfg.TagFilterPrefix) {
			continue
		}
		if cfg.TagFilterContains != "" && !strings.Contains(rawTag, cfg.TagFilterContains) {
			continue
		}

		stripped := strings.TrimPrefix(rawTag, cfg.StripPrefix)
		v, err := semver.NewVersion(stripped)
		if err != nil {
			continue // skip non-semver
		}

		if v.Prerelease() != "" {
			continue
		}

		// Filter by current major/minor if specified
		if cfg.CurrentMajor != nil && v.Major() < int64(*cfg.CurrentMajor) {
			continue
		}
		if cfg.CurrentMinor != nil && cfg.CurrentMajor != nil && v.Major() == int64(*cfg.CurrentMajor) && v.Minor() < int64(*cfg.CurrentMinor) {
			continue
		}

		candidates = append(candidates, struct {
			Tag      string
			Stripped string
			SHA      string
			Semver   *semver.Version
		}{
			Tag:      rawTag,
			Stripped: stripped,
			SHA:      tag.GetCommit().GetSHA(),
			Semver:   v,
		})
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].Semver.GreaterThan(candidates[j].Semver)
	})

	for _, candidate := range candidates {
		commit, _, err := client.Repositories.GetCommit(ctx, owner, repo, candidate.SHA, nil)
		if err != nil {
			if strings.Contains(err.Error(), "404") {
				continue // try next one
			}
			return nil, fmt.Errorf("failed to get commit for tag %q: %w", candidate.Tag, err)
		}

		if len(commit.Parents) == 0 {
			continue
		}

		refs, _, err := client.Git.ListMatchingRefs(ctx, owner, repo, &github.ReferenceListOptions{
			Ref: "tags",
		})
		if err != nil {
			return nil, fmt.Errorf("failed to list refs: %w", err)
		}

		tagReachable := false
		for _, ref := range refs {
			if ref.Object != nil && ref.Object.GetSHA() == candidate.SHA {
				tagReachable = true
				break
			}
		}
		if !tagReachable {
			continue // tag points to a commit not reachable by any known ref
		}

		return &GitHubVersionResult{
			Version: candidate.Stripped,
			Commit:  candidate.SHA,
		}, nil
	}

	return nil, nil // No valid semver tag found with a resolvable commit
}

func FetchLatestRelease(ctx context.Context, client *github.Client, cfg GitHubMonitorConfig) (*GitHubVersionResult, error) {
	identifier := strings.Split(cfg.Identifier, "/")
	if len(identifier) != 2 {
		return nil, fmt.Errorf("invalid github identifier: %q", cfg.Identifier)
	}
	owner := identifier[0]
	repo := identifier[1]

	var releases []*github.RepositoryRelease
	opt := &github.ListOptions{PerPage: 100}
	for {
		page, resp, err := client.Repositories.ListReleases(ctx, owner, repo, opt)
		if err != nil {
			return nil, fmt.Errorf("failed to list releases: %w", err)
		}
		releases = append(releases, page...)
		if resp.NextPage == 0 {
			break
		}
		opt.Page = resp.NextPage
	}

	var candidates []struct {
		Tag      string
		Stripped string
		Semver   *semver.Version
	}

	for _, rel := range releases {
		tag := rel.GetTagName()

		if cfg.TagFilter != "" && !strings.HasPrefix(tag, cfg.TagFilter) {
			continue
		}
		if cfg.TagFilterPrefix != "" && !strings.HasPrefix(tag, cfg.TagFilterPrefix) {
			continue
		}
		if cfg.TagFilterContains != "" && !strings.Contains(tag, cfg.TagFilterContains) {
			continue
		}

		stripped := strings.TrimPrefix(tag, cfg.StripPrefix)
		stripped = strings.TrimSuffix(stripped, cfg.StripSuffix)

		v, err := semver.NewVersion(stripped)
		if err != nil {
			continue
		}

		if v.Prerelease() != "" {
			continue
		}

		// Filter by current major/minor if specified
		if cfg.CurrentMajor != nil && v.Major() < int64(*cfg.CurrentMajor) {
			continue
		}
		if cfg.CurrentMinor != nil && cfg.CurrentMajor != nil && v.Major() == int64(*cfg.CurrentMajor) && v.Minor() < int64(*cfg.CurrentMinor) {
			continue
		}

		candidates = append(candidates, struct {
			Tag      string
			Stripped string
			Semver   *semver.Version
		}{
			Tag:      tag,
			Stripped: stripped,
			Semver:   v,
		})
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].Semver.GreaterThan(candidates[j].Semver)
	})

	for _, candidate := range candidates {
		ref, _, err := client.Git.GetRef(ctx, owner, repo, "refs/tags/"+candidate.Tag)
		if err != nil {
			continue
		}

		obj := ref.GetObject()
		var sha string

		if obj.GetType() == "commit" {
			sha = obj.GetSHA()
		} else if obj.GetType() == "tag" {
			tagObj, _, err := client.Git.GetTag(ctx, owner, repo, obj.GetSHA())
			if err != nil {
				continue
			}
			sha = tagObj.GetObject().GetSHA()
		} else {
			continue
		}

		return &GitHubVersionResult{
			Version: candidate.Tag,
			Commit:  sha,
		}, nil
	}

	return nil, nil // No valid semver release tag found with a resolvable commit
}
