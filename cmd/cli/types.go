package cli

type CreatePackageRequest struct {
	MelangeYaml     string               `json:"melangeYaml"`
	ApkoYaml        *string              `json:"apkoYaml,omitempty"`
	AdditionalFiles *AdditionalFilesData `json:"additionalFiles,omitempty"`
	UseRoot         bool                 `json:"useRoot"`
}

type AdditionalFilesData struct {
	Filename string `json:"filename"`
	Data     string `json:"data"`
}

type CreatePackageResponse struct {
	Success   bool   `json:"success"`
	PackageID string `json:"packageId"`
	Error     string `json:"error,omitempty"`
}
