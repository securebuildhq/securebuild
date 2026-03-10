package oidc

import (
	"context"
)

// OIDCAudienceDefault is the default audience for OIDC tokens used in keyless signing (Sigstore).
// Override this if you need a different audience for a specific use case.
const OIDCAudienceDefault = "sigstore"

// Doppler environment variables expected for GCP OIDC provider:
//
//	OIDC_GCP_ATTESTOR_ACCOUNT   - Service account email
//	OIDC_GCP_ATTESTOR_KEY_JSON  - Service account credentials JSON
//	OIDC_GCP_PROJECT_ID         - GCP project ID (if needed)
//
// These should be set in the environment by Doppler for all environments.
// OIDCProvider defines the interface for obtaining OIDC ID tokens from a provider.
type OIDCProvider interface {
	// GetIDToken returns an OIDC ID token for the given audience.
	GetIDToken(ctx context.Context, audience string) (string, error)
}
