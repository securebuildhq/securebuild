package types

import "time"

type Image struct {
	ID             string
	Name           string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	APKOs          []*ImageAPKO
	AlternateImage string
	Readme         string
	GitRemote      string
	ApkoFilePath   string
	TagTemplate    string
}

type ImageAPKO struct {
	ID            string
	Name          string
	Tags          []string
	CreatedAt     time.Time
	UpdatedAt     time.Time
	LatestVersion ImageAPKOVersion
	Readme        string
	GitRemote     string
	GitTag        string
	ApkoFilePath  string
}

type ImageAPKOVersion struct {
	ID           string
	ImageApkoID  string
	APKOYAML     string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	GitRemote    string
	ApkoFilePath string
	GitCommitSHA string
}

type ImageCatalogItem struct {
	ID          string
	Name        string
	Tag         string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	IsPublished bool
	IndexDigest string
	APKOId      string
}

type APKPackageVersion struct {
	Name               string
	Version            string
	VersionWithRelease string
	Major              string
	Minor              string
	Patch              string
	Release            string
	PinnedVersion      string
}

type ImageScanResult struct {
	CriticalCount int `json:"critical"`
	HighCount     int `json:"high"`
	MediumCount   int `json:"medium"`
	LowCount      int `json:"low"`
	TotalCount    int `json:"total"`
	FixableCount  int `json:"fixable"`
}

type ScanDescriptor struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type ImageScanResultDetails struct {
	Counts      ImageScanResult   `json:"counts"`
	FixedCounts ImageScanResult   `json:"fixed_counts"`
	CreatedAt   time.Time         `json:"created_at"`
	Critical    map[string]string `json:"critical"`
	High        map[string]string `json:"high"`
	Medium      map[string]string `json:"medium"`
	Low         map[string]string `json:"low"`
	Descriptor  ScanDescriptor    `json:"descriptor"`

	VulnerabilityDetails []VulnerabilityDetail `json:"vulnerability_details"`
}

type VulnerabilityDetail struct {
	CVE             string   `json:"cve"`
	Description     string   `json:"description"`
	ArtifactID      string   `json:"artifact_id"`
	ArtifactType    string   `json:"artifact_type"`
	ArtifactName    string   `json:"artifact_name"`
	ArtifactVersion string   `json:"artifact_version"`
	ArtifactPath    string   `json:"artifact_path"`
	FixState        string   `json:"fix_state"`
	FixVersions     []string `json:"fix_versions"`
	Severity        string   `json:"severity"`
	EpssPercentile  float64  `json:"epss_percentile"`
	Risk            float64  `json:"risk"`
}

type ImageExternalRegistry struct {
	ID          string
	RegistryURL string
	Username    string
	Password    string
}

type ImageBuild struct {
	ID                 string     `json:"id"`
	ImageApkoVersionID string     `json:"image_apko_version_id"`
	Status             string     `json:"status"`
	CreatedAt          time.Time  `json:"created_at"`
	TimeoutAt          *time.Time `json:"timeout_at"`
	BuilderID          *string    `json:"builder_id"`
	BuildStartedAt     *time.Time `json:"build_started_at"`
	BuildFinishedAt    *time.Time `json:"build_finished_at"`
	WorkerError        *string    `json:"worker_error"`
}

type ImageBuildStatus string

const (
	ImageBuildStatusPending    ImageBuildStatus = "pending"
	ImageBuildStatusQueued     ImageBuildStatus = "queued"
	ImageBuildStatusBuilding   ImageBuildStatus = "building"
	ImageBuildStatusTesting    ImageBuildStatus = "testing"
	ImageBuildStatusPublishing ImageBuildStatus = "publishing"
	ImageBuildStatusSuccess    ImageBuildStatus = "success"
	ImageBuildStatusFailed     ImageBuildStatus = "failed"
	ImageBuildStatusTimedOut   ImageBuildStatus = "timed_out"
)
