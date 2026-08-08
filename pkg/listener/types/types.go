package types

type ExternalImageScanPayload struct {
	Digest string `json:"digest"`
}

type ExternalImageSbomPayload struct {
	Digest             string `json:"digest"`
	TeamID             string `json:"team_id,omitempty"`
	EnqueueRescanAfter bool   `json:"enqueue_rescan_after,omitempty"`
}

type ExternalImageSignaturesPayload struct {
	Digest string `json:"digest"`
}
