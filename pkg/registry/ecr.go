package registry

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/ecr"
	"github.com/google/go-containerregistry/pkg/authn"
)

// GetCredentialsForEndpoint returns the appropriate credentials for a registry endpoint.
// For ECR registries with AWS access keys, it fetches a fresh authorization token.
// For other registries or pre-exchanged ECR tokens, it returns the credentials as-is.
func GetCredentialsForEndpoint(ctx context.Context, endpoint string, username string, password string) (authn.Authenticator, error) {
	if username == "" || password == "" {
		return authn.Anonymous, nil
	}

	// Only do ECR token exchange if:
	// 1. It's a private ECR endpoint
	// 2. The username is not "AWS" (if the username is "AWS" this indicates a
	// pre-exchanged ECR token which may still exist in the database and has not
	// yet been updated to AWS credentials, so just use that as-is)
	if isPrivateECREndpoint(endpoint) && username != "AWS" {
		return getECRPrivateCredentials(ctx, endpoint, username, password)
	}

	// Use credentials as-is (regular registry or pre-exchanged ECR token)
	return &authn.Basic{Username: username, Password: password}, nil
}

// getECRPrivateCredentials fetches a fresh ECR authorization token using AWS credentials
func getECRPrivateCredentials(ctx context.Context, endpoint string, accessKeyID string, secretAccessKey string) (authn.Authenticator, error) {
	registryID, region, err := parseECREndpoint(endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse ECR endpoint: %w", err)
	}

	cfg := aws.Config{
		Region:      region,
		Credentials: credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, ""),
	}

	client := ecr.NewFromConfig(cfg)

	output, err := client.GetAuthorizationToken(ctx, &ecr.GetAuthorizationTokenInput{
		RegistryIds: []string{registryID},
	})
	if err != nil {
		return nil, fmt.Errorf("get ECR authorization token: %w", err)
	}

	if len(output.AuthorizationData) == 0 {
		return nil, fmt.Errorf("no authorization data returned for ECR registry %s", endpoint)
	}

	authToken := aws.ToString(output.AuthorizationData[0].AuthorizationToken)
	decodedToken, err := base64.StdEncoding.DecodeString(authToken)
	if err != nil {
		return nil, fmt.Errorf("decode ECR token: %w", err)
	}

	parts := strings.SplitN(string(decodedToken), ":", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid ECR token format")
	}

	return &authn.Basic{Username: parts[0], Password: parts[1]}, nil
}

// isPrivateECREndpoint checks if the host is a private ECR endpoint
// Format: <account-id>.dkr.ecr.<region>.amazonaws.com
func isPrivateECREndpoint(host string) bool {
	return strings.Contains(host, ".dkr.ecr.") && strings.HasSuffix(host, ".amazonaws.com")
}

// parseECREndpoint extracts the registry ID and region from an ECR endpoint
// Expected format: <registry-id>.dkr.ecr.<region>.amazonaws.com
func parseECREndpoint(endpoint string) (registryID string, region string, err error) {
	parts := strings.Split(endpoint, ".")
	if len(parts) < 6 {
		return "", "", fmt.Errorf("invalid ECR endpoint format: %s", endpoint)
	}

	if parts[1] != "dkr" || parts[2] != "ecr" {
		return "", "", fmt.Errorf("invalid ECR endpoint format: %s (expected .dkr.ecr.)", endpoint)
	}

	return parts[0], parts[3], nil
}
