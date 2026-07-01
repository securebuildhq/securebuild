package types

import "time"

type TestPackageStatus string

const (
	TestPackageStatusPending TestPackageStatus = "pending"
	TestPackageStatusRunning TestPackageStatus = "running"
	TestPackageStatusSuccess TestPackageStatus = "success"
	TestPackageStatusFailed  TestPackageStatus = "failed"
)

type CompbinedOutput struct {
	Stdout string
	Stderr string
}

type APKCatalogItem struct {
	PackageVersionID    string
	Arch                string
	Name                string
	Version             string
	Release             int
	ArtifactPublishedAt time.Time
	IndexPublishedAt    *time.Time
	IndexContent        map[string]string
}

type TestPackage struct {
	ID          string
	UserID      string
	SessionID   string
	MelangeYaml string
	Arch        string
	Status      string
	CreatedAt   time.Time
	BuildOutput *CompbinedOutput
}

type GenerateApko struct {
	ID          string
	UserID      string
	SessionID   string
	MelangeYaml string
	CreatedAt   time.Time
	ApkoYaml    string
}

type GenerateMelange struct {
	ID          string
	UserID      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	CompletedAt time.Time
	Messages    []*GenerateMelangeMessage
}

type GenerateMelangeMessage struct {
	ID          string
	CreatedAt   time.Time
	Prompt      string
	Response    string
	MelangeYaml string
}

type CreatePackage struct {
	ID                  string
	MelangeYaml         string
	AdditionalFilesData *string
	UseRoot             bool
	CustomDiskSize      *int
	CreatedAt           time.Time
	PackageID           string
	CreatedByUserID     string
	CreatedByUserName   string
}

type Package struct {
	ID                        string    `json:"id"`
	Name                      string    `json:"name"`
	CreatedAt                 time.Time `json:"createdAt"`
	UpdatedAt                 time.Time `json:"updatedAt"`
	Subpackages               []Package `json:"subpackages"`
	ParentID                  *string   `json:"parentId,omitempty"`
	IsDeleteProtectionEnabled bool      `json:"isDeleteProtectionEnabled"`
}

type PackageVersion struct {
	ID          string    `json:"id"`
	PackageID   string    `json:"packageId"`
	Version     string    `json:"version"`
	MelangeYaml string    `json:"melangeYaml"`
	CreatedAt   time.Time `json:"createdAt"`
	APKRelease  int       `json:"apkRelease"`
	License     string    `json:"license"`

	UseRoot bool `json:"useRoot"`

	// Bootstrap mode configuration
	BootstrapEnabled       bool    `json:"bootstrapEnabled"`
	BootstrapApkRepository *string `json:"bootstrapApkRepository"`
	BootstrapKeyringAppend *string `json:"bootstrapKeyringAppend"`

	// Custom disk size for build VMs (in GB)
	CustomDiskSize *int `json:"customDiskSize"`

	// Git link fields (set when the package version is from an external git repo)
	GitRemote       string `json:"gitRemote"`
	MelangeFilePath string `json:"melangeFilePath"`
	GitTag          string `json:"gitTag"`
	GitCommitSHA    string `json:"gitCommitSha"`
}

type AdditionalFile struct {
	ID      string `json:"id"`
	Path    string `json:"path"`
	Content string `json:"content"`
}

type PackageVersionProvides struct {
	ID               string `json:"id"`
	PackageVersionID string `json:"packageVersionId"`
	PackageName      string `json:"packageName"`
	ProvidesName     string `json:"providesName"`
	IsSubpackage     bool   `json:"isSubpackage"`
}
