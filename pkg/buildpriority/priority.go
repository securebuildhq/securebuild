// Package buildpriority supplies persistent upstream-version keys and SQL ranking.
package buildpriority

import (
	"fmt"
	"regexp"
	"strings"
)

var versionPattern = regexp.MustCompile(`^v?([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$`)
var numericIdentifier = regexp.MustCompile(`^[0-9]+$`)

// VersionKey returns the highest supported version's intrinsic sort key. Compare
// keys with PostgreSQL COLLATE "C". Empty means unrankable; NULL is reserved for
// records awaiting backfill. Keep this encoding in sync with the web app helper.
// Core components support up to 20 digits, without floating point conversion.
func VersionKey(versions ...string) string {
	best := ""
	for _, raw := range versions {
		m := versionPattern.FindStringSubmatch(raw)
		if m == nil {
			continue
		}
		var core []string
		for _, part := range m[1:4] {
			part = strings.TrimLeft(part, "0")
			if part == "" {
				part = "0"
			}
			if len(part) > 20 {
				core = nil
				break
			}
			core = append(core, strings.Repeat("0", 20-len(part))+part)
		}
		if len(core) != 3 {
			continue
		}
		key := strings.Join(core, ".") + "/"
		if m[4] == "" {
			key += "~" // stable sorts after all prereleases
		} else {
			valid := true
			for _, part := range strings.Split(m[4], ".") {
				if numericIdentifier.MatchString(part) {
					if len(part) > 1 && part[0] == '0' {
						valid = false
						break
					}
					// Numeric identifiers precede text; length precedes digits.
					key += fmt.Sprintf("0%010d%s!", len(part), part)
				} else {
					// ! sorts before every allowed identifier character, so a
					// shorter identifier precedes one with the same prefix.
					key += "1" + part + "!"
				}
			}
			if !valid {
				continue
			}
		}
		if key > best {
			best = key
		}
	}
	return best
}

// VersionRank ranks known keys within each family. Unknown metadata shares rank
// zero with the newest known version and retains FIFO eligibility.
const VersionRank = `CASE WHEN family IS NULL OR family = '' OR version_key IS NULL THEN 0
	ELSE DENSE_RANK() OVER (PARTITION BY family ORDER BY version_key COLLATE "C" DESC NULLS LAST) - 1 END`
