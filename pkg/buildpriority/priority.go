// Package buildpriority orders pending builds by upstream version within a family.
package buildpriority

import (
	"sort"
	"time"

	"github.com/Masterminds/semver/v3"
)

// Candidate describes work that is ready to run. Versions excludes rebuild epochs:
// rebuilding an old release must not make it newer than a recent upstream release.
type Candidate struct {
	ID        string
	Family    string
	Versions  []string
	Priority  int
	CreatedAt time.Time
}

// Order returns IDs with explicit priority first, then version rank (newest in
// each family, next newest, etc.), then FIFO. Unrelated version numbers are never
// compared. Missing or non-semver metadata receives rank zero and uses FIFO.
func Order(candidates []Candidate) []string {
	versions := make(map[string]*semver.Version, len(candidates))
	families := make(map[string][]*semver.Version)
	for _, c := range candidates {
		if c.Family == "" {
			continue
		}
		for _, raw := range c.Versions {
			v, err := semver.NewVersion(raw)
			if err == nil && (versions[c.ID] == nil || v.GreaterThan(versions[c.ID])) {
				versions[c.ID] = v
			}
		}
		if v := versions[c.ID]; v != nil {
			families[c.Family] = append(families[c.Family], v)
		}
	}
	for family, vs := range families {
		sort.Slice(vs, func(i, j int) bool { return vs[i].GreaterThan(vs[j]) })
		unique := vs[:0]
		for _, v := range vs {
			if len(unique) == 0 || !v.Equal(unique[len(unique)-1]) {
				unique = append(unique, v)
			}
		}
		families[family] = unique
	}
	ranks := make(map[string]int, len(candidates))
	for _, c := range candidates {
		if v := versions[c.ID]; v != nil {
			ranks[c.ID] = sort.Search(len(families[c.Family]), func(i int) bool {
				return !families[c.Family][i].GreaterThan(v)
			})
		}
	}
	ordered := append([]Candidate(nil), candidates...)
	sort.Slice(ordered, func(i, j int) bool {
		a, b := ordered[i], ordered[j]
		if a.Priority != b.Priority {
			return a.Priority > b.Priority
		}
		if ranks[a.ID] != ranks[b.ID] {
			return ranks[a.ID] < ranks[b.ID]
		}
		if !a.CreatedAt.Equal(b.CreatedAt) {
			return a.CreatedAt.Before(b.CreatedAt)
		}
		return a.ID < b.ID
	})
	ids := make([]string, len(ordered))
	for i, c := range ordered {
		ids[i] = c.ID
	}
	return ids
}
