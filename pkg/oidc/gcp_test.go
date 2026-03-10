//go:build integration
// +build integration

package oidc

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/pkg/param"
	"google.golang.org/api/option"
)

func TestGCPProvider_GetIDToken(t *testing.T) {
	t.Parallel()

	// Initialise params from environment (populated by Doppler). Skip if unavailable.
	ctx, err := param.Init(param.InitSourceEnvironment, nil)
	if err != nil {
		t.Skipf("unable to init params from env: %v", err)
	}

	serviceAccount := param.GetParam(ctx).OIDCGCPAttestorAccount
	credsJSON := param.GetParam(ctx).OIDCGCPAttestorKeyJSON

	if serviceAccount == "" || credsJSON == "" {
		t.Skip("OIDC GCP params missing; skipping integration test")
	}

	audience := getAudience(ctx)

	ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	provider, err := NewGCPProvider(ctx, serviceAccount, option.WithCredentialsJSON([]byte(credsJSON)))
	if err != nil {
		t.Fatalf("failed to create GCPProvider: %v", err)
	}
	defer provider.Close()

	token, err := provider.GetIDToken(ctx, audience)
	if err != nil {
		t.Fatalf("failed to get ID token: %v", err)
	}

	t.Logf("token length: %d", len(token))
	if len(token) > 20 {
		t.Logf("token prefix: %s… suffix: …%s", token[:10], token[len(token)-10:])
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("token does not have 3 parts (header.payload.signature)")
	}

	decode := func(part string) map[string]interface{} {
		b, err := base64.RawURLEncoding.DecodeString(part)
		if err != nil {
			t.Fatalf("failed to base64 decode JWT part: %v", err)
		}
		var out map[string]interface{}
		if err := json.Unmarshal(b, &out); err != nil {
			t.Fatalf("failed to unmarshal JWT part: %v", err)
		}
		return out
	}
	header := decode(parts[0])
	payload := decode(parts[1])
	t.Logf("JWT Header typ=%v alg=%v", header["typ"], header["alg"])
	t.Logf("JWT Payload iss=%v sub=%v aud=%v", payload["iss"], payload["sub"], payload["aud"])

	// Negative sub-test: empty audience should error.
	t.Run("empty audience", func(t *testing.T) {
		if _, err := provider.GetIDToken(ctx, ""); err == nil {
			t.Fatalf("expected error for empty audience, got nil")
		}
	})
}

// getAudience returns the audience to request in the ID token. Override by
// setting OIDC_AUDIENCE env var to reuse the test in different environments.
func getAudience(ctx context.Context) string {
	if v := param.GetParam(ctx).OIDCAudienceOverride; v != "" {
		return v
	}
	return OIDCAudienceDefault
}
