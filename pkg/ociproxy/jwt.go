package ociproxy

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/securebuildhq/securebuild/pkg/param"
)

// OCITokenClaims represents the claims in our OCI registry JWT tokens
type OCITokenClaims struct {
	ID          string `json:"jti"`               // JWT ID (unique identifier)
	Issuer      string `json:"iss"`               // Issuer
	Subject     string `json:"sub"`               // Subject (service account ID or "anonymous")
	Audience    string `json:"aud"`               // Audience (service parameter)
	ExpiresAt   int64  `json:"exp"`               // Expiration time (Unix timestamp)
	IssuedAt    int64  `json:"iat"`               // Issued at (Unix timestamp)
	Scope       string `json:"scope"`             // Repository scope
	IsAnonymous bool   `json:"is_anonymous"`      // Whether this is an anonymous token
	TeamID      string `json:"team_id,omitempty"` // Team ID for authenticated users
	Repository  string `json:"repository"`        // Repository name
}

// OCITokenHeader represents the JWT header
type OCITokenHeader struct {
	Type      string `json:"typ"`
	Algorithm string `json:"alg"`
}

// JWT helper functions for OCI proxy tokens
func generateOCIToken(ctx context.Context, claims OCITokenClaims) (string, error) {
	// Use OCIProxyJWTSecret as JWT signing key
	signingKey := param.GetParam(ctx).OCIProxyJWTSecret
	if signingKey == "" {
		return "", fmt.Errorf("OCI_PROXY_JWT_SECRET not configured")
	}

	// JWT Header
	header := OCITokenHeader{
		Type:      "JWT",
		Algorithm: "HS256",
	}

	// Encode header and payload
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", fmt.Errorf("failed to marshal JWT header: %w", err)
	}

	payloadJSON, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("failed to marshal JWT payload: %w", err)
	}

	// Base64URL encode (without padding)
	headerB64 := base64.RawURLEncoding.EncodeToString(headerJSON)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payloadJSON)

	// Create signature input
	signingInput := headerB64 + "." + payloadB64

	// Generate HMAC-SHA256 signature
	h := hmac.New(sha256.New, []byte(signingKey))
	h.Write([]byte(signingInput))
	signature := h.Sum(nil)
	signatureB64 := base64.RawURLEncoding.EncodeToString(signature)

	// Complete JWT: header.payload.signature
	token := signingInput + "." + signatureB64
	return token, nil
}

func validateOCIToken(ctx context.Context, token string) (*OCITokenClaims, error) {
	// Use OCIProxyJWTSecret as JWT signing key
	signingKey := param.GetParam(ctx).OCIProxyJWTSecret
	if signingKey == "" {
		return nil, fmt.Errorf("OCI_PROXY_JWT_SECRET not configured")
	}

	// Split JWT into parts
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid JWT format: expected 3 parts, got %d", len(parts))
	}

	headerB64, payloadB64, signatureB64 := parts[0], parts[1], parts[2]

	// Verify signature
	signingInput := headerB64 + "." + payloadB64
	h := hmac.New(sha256.New, []byte(signingKey))
	h.Write([]byte(signingInput))
	expectedSignature := h.Sum(nil)
	expectedSignatureB64 := base64.RawURLEncoding.EncodeToString(expectedSignature)

	if signatureB64 != expectedSignatureB64 {
		return nil, fmt.Errorf("invalid JWT signature")
	}

	// Decode payload
	payloadJSON, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode JWT payload: %w", err)
	}

	var claims OCITokenClaims
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JWT claims: %w", err)
	}

	// Check expiration
	now := time.Now().Unix()
	if claims.ExpiresAt <= now {
		return nil, fmt.Errorf("JWT token expired")
	}

	return &claims, nil
}
