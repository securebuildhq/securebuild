package types

type ExternalImageScanPayload struct {
	Digest string `json:"digest"`
}

type ExternalImageSbomPayload struct {
	Digest               string `json:"digest"`
	Arch                 string `json:"arch,omitempty"`
	TeamID               string `json:"team_id,omitempty"`
	CredentialID         string `json:"credential_id,omitempty"`
	EnqueueRescanAfter   bool   `json:"enqueue_rescan_after,omitempty"`
	ArchitectureVerified bool   `json:"architecture_verified,omitempty"`
}

type ExternalImageSignaturesPayload struct {
	Digest string `json:"digest"`
}
