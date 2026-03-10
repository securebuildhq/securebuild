package oidc

import (
	"context"
	"fmt"

	"cloud.google.com/go/iam/credentials/apiv1"
	"google.golang.org/api/option"
	credentialspb "google.golang.org/genproto/googleapis/iam/credentials/v1"
)

// GCPProvider implements OIDCProvider for Google Cloud Platform.
//
// It holds a long-lived IAM Credentials client that must be released when the
// provider is no longer needed — call Close to free the underlying gRPC
// connections. The provider is primarily consumed by SecureBuild’s key-less
// cosign helpers to obtain ID tokens that will later be embedded in signing
// certificates for OCI images and artifacts.
type GCPProvider struct {
	serviceAccountEmail string
	client              *credentials.IamCredentialsClient
}

// NewGCPProvider creates a new GCPProvider for the given service account email.
// Pass option.WithCredentialsJSON([]byte(os.Getenv("OIDC_GCP_ATTESTOR_KEY_JSON")))
// to use Doppler-provided credentials.
//
// The returned provider must be closed via Close() once you’re finished with it.
func NewGCPProvider(ctx context.Context, serviceAccountEmail string, opts ...option.ClientOption) (*GCPProvider, error) {
	if serviceAccountEmail == "" {
		return nil, fmt.Errorf("serviceAccountEmail must not be empty")
	}

	client, err := credentials.NewIamCredentialsClient(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create IAM Credentials client: %w", err)
	}
	return &GCPProvider{
		serviceAccountEmail: serviceAccountEmail,
		client:              client,
	}, nil
}

// GetIDToken fetches an OIDC ID token for the provided audience. Audience must
// be non-empty.
//
// IncludeEmail is intentionally set to true because the e-mail address is
// embedded in the Fulcio certificate chain used during key-less signing.
func (g *GCPProvider) GetIDToken(ctx context.Context, audience string) (string, error) {
	if audience == "" {
		return "", fmt.Errorf("audience must not be empty")
	}

	req := &credentialspb.GenerateIdTokenRequest{
		Name:         "projects/-/serviceAccounts/" + g.serviceAccountEmail,
		Audience:     audience,
		IncludeEmail: true, // required by our signing chain
	}
	resp, err := g.client.GenerateIdToken(ctx, req)
	if err != nil {
		return "", fmt.Errorf("failed to generate ID token: %w", err)
	}
	return resp.Token, nil
}

// Close releases resources held by the underlying IAM Credentials client.
func (g *GCPProvider) Close() error {
	return g.client.Close()
}
