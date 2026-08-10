package types

import "time"

type ExternalImage struct {
	TeamID    string
	Digest    string
	Registry  string
	ImageName string
	Tags      []string
	CreatedAt time.Time
}

type ExternalImageSBOM struct {
	Digest      string // Manifest digest
	Arch        string
	SBOM        string
	Source      string
	CreatedAt   time.Time
	ImageDigest string // Per-architecture digest
}
