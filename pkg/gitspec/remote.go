package gitspec

import "strings"

// GitRemoteVariants returns equivalent spellings for repository lookups without
// changing the host, owner, or repository name.
func GitRemoteVariants(remote string) []string {
	base := strings.TrimSuffix(strings.TrimRight(remote, "/"), ".git")
	if base == "" {
		return nil
	}
	return []string{base, base + ".git", base + "/", base + ".git/"}
}
