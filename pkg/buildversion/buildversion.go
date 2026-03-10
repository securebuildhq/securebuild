// Package buildversion holds version, git SHA, and build time
// set at build time via ldflags.
package buildversion

var (
	version   string
	gitSHA    string
	buildTime string
)

// Version returns the version string (e.g. "1.2.3" or "0.0.0-dev").
func Version() string {
	if version == "" {
		return "0.0.0-dev"
	}
	return version
}

// GitSHA returns the git commit SHA at build time.
func GitSHA() string {
	if gitSHA == "" {
		return "unknown"
	}
	return gitSHA
}

// BuildTime returns the build timestamp (UTC).
func BuildTime() string {
	if buildTime == "" {
		return "unknown"
	}
	return buildTime
}
