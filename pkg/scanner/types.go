package scanner

import "time"

// CVE represents a Common Vulnerabilities and Exposures entry
type CVE struct {
	ID           string    `json:"id"`
	PackageName  string    `json:"package_name"`
	Ecosystem    string    `json:"ecosystem"`
	Severity     string    `json:"severity"`
	Description  string    `json:"description"`
	FixedVersion string    `json:"fixed_version,omitempty"` // Empty if unfixable
	References   []string  `json:"references,omitempty"`
	PublishedAt  time.Time `json:"published_at,omitempty"`
	ModifiedAt   time.Time `json:"modified_at,omitempty"`
}

// OSVMapping represents a mapping from package name to OSV ecosystem identifier
type OSVMapping struct {
	PackageName    string `json:"package_name"`
	OSVEcosystem   string `json:"osv_ecosystem"`
	OSVPackageName string `json:"osv_package_name"`
}

// VersionRange represents a version range for vulnerability matching
type VersionRange struct {
	Introduced string `json:"introduced,omitempty"`
	Fixed      string `json:"fixed,omitempty"`
}
