package githubsync

import "time"

// FileEntry represents a file to be written to the GitHub repository
type FileEntry struct {
	Path    string
	Content string
}

// PackageVersion represents a package version from the database
type PackageVersion struct {
	ID          string
	PackageName string
	FamilyName  string
	Version     string
	MelangeYaml string
	UpdatedAt   time.Time
	Epoch       int // Parsed from melange YAML
}

// ImageAPKOVersion represents an image APKO version from the database
// Since we unnest tags, each row represents one tag for an APKO YAML
type ImageAPKOVersion struct {
	ID        string
	ImageName string
	Tag       string
	APKOYAML  string
	TestYAML  string // Optional test YAML for this APKO version
}

// AdditionalFile represents an additional file (patch, config, etc.) for a package
type AdditionalFile struct {
	Filename string
	Content  string
}
