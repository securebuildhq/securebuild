package sbom

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/securebuildhq/securebuild/pkg/externalimage"
	"github.com/securebuildhq/securebuild/pkg/logger"
	registrypkg "github.com/securebuildhq/securebuild/pkg/registry"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
)

// DockerHubTokenResponse represents the response from Docker Hub auth
type DockerHubTokenResponse struct {
	Token       string `json:"token"`
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	IssuedAt    string `json:"issued_at"`
}

// SBOMResult represents an SBOM for a specific architecture
type SBOMResult struct {
	Architecture   string `json:"architecture"`
	SBOM           string `json:"sbom"`
	Source         string `json:"source"` // "syft"
	ImageSizeBytes int64  `json:"image_size_bytes"`
	ImageDigest    string `json:"image_digest"` // per-architecture manifest digest
}

func FetchSBOM(ctx context.Context, teamID string, registry string, imageName string, digest string) (results []SBOMResult, err error) {
	span, ctx := telemetry.StartSpan(ctx, "sbom.FetchSBOM")
	defer func() {
		if err != nil {
			span.SetTag("error", err)
		}
		span.Finish()
	}()

	logger.Info("fetching SBOMs for image", zap.String("imageURL", registry+"/"+imageName+"@"+digest))

	// Set up authentication
	auth := authn.Anonymous
	isAnonDockerHub := false

	username, password, err := externalimage.GetExternalImageCredentials(ctx, teamID, registry, imageName)
	if err != nil {
		logger.Warn("failed to get external image credentials, continuing with anonymous auth", zap.Error(err))
	} else if username != "" && password != "" {
		logger.Info("using external image credentials")
		// Use registry package to get credentials - this handles ECR token exchange
		auth, err = registrypkg.GetCredentialsForEndpoint(ctx, registry, username, password)
		if err != nil {
			return nil, fmt.Errorf("failed to get credentials for registry %s: %w", registry, err)
		}
	}

	// Handle Docker Hub authentication
	if auth == authn.Anonymous && isDockerHub(registry) {
		logger.Info("Docker Hub detected, getting authentication token")
		dockerAuth, err := getDockerHubAuth(ctx, registry+"/"+imageName)
		if err != nil {
			logger.Warn("failed to get Docker Hub token, continuing with anonymous auth", zap.Error(err))
			auth = authn.Anonymous
		} else {
			auth = dockerAuth
			isAnonDockerHub = true
		}
	}

	// Generate SBOMs for both architectures using syft
	architectures := []string{"linux/amd64", "linux/arm64"}

	for _, platform := range architectures {
		sbom, imageSize, imageDigest, err := generateSBOMWithSyft(ctx, registry, imageName, digest, auth, isAnonDockerHub, platform)
		if err != nil {
			if strings.Contains(err.Error(), "does not match user specified platform") {
				logger.Info("no SBOM for architecture, skipping",
					zap.String("imageName", imageName),
					zap.String("digest", digest),
					zap.String("platform", platform))
				continue
			}
			return nil, fmt.Errorf("failed to generate SBOM for %s@%s platform %s: %w", imageName, digest, platform, err)
		}

		if sbom != "" {
			logger.Info("successfully generated SBOM with syft", zap.String("platform", platform))
			results = append(results, SBOMResult{
				Architecture:   platform,
				SBOM:           sbom,
				Source:         "syft",
				ImageSizeBytes: imageSize,
				ImageDigest:    imageDigest,
			})
		}
	}

	if len(results) == 0 {
		imageURL := registry + "/" + imageName + "@" + digest
		logger.Warn("no SBOMs could be generated for any architecture", zap.String("imageURL", imageURL))
		return nil, nil
	}

	logger.Info("successfully generated SBOMs", zap.Int("count", len(results)))
	return results, nil
}

func generateSBOMWithSyft(ctx context.Context, registry string, imageName string, digest string, auth authn.Authenticator, isAnonDockerHub bool, platform string) (sbom string, imageSizeBytes int64, imageDigest string, err error) {
	logger.Info("generating SBOM with syft", zap.String("imageRef", registry+"/"+imageName+"@"+digest), zap.String("platform", platform))

	// Create a timeout context for syft execution (syft can take a while)
	syftCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	// Set up environment variables
	env := os.Environ()

	// Handle authentication for private registries
	// For public Docker Hub images, skip authentication as syft can access them directly
	if auth != authn.Anonymous && !isAnonDockerHub {
		authConfig, err := auth.Authorization()
		if err != nil {
			logger.Warn("failed to get auth config for syft", zap.Error(err))
		} else {
			if authConfig.Username != "" && authConfig.Password != "" {
				logger.Debug("setting up Docker config for syft with username/password")

				tmpDir, err := os.MkdirTemp("", "syft-docker-config")
				if err != nil {
					logger.Warn("failed to create temp directory for syft docker config", zap.Error(err))
				} else {
					defer os.RemoveAll(tmpDir)

					// Get the normalized registry name
					registryName := normalizeRegistryNameForDockerConfig(registry)

					// Create proper Docker config.json with username/password
					dockerConfig := map[string]interface{}{
						"auths": map[string]interface{}{
							registryName: map[string]interface{}{
								"username": authConfig.Username,
								"password": authConfig.Password,
							},
						},
					}

					configJSON, err := json.Marshal(dockerConfig)
					if err == nil {
						configPath := tmpDir + "/config.json"
						if err := os.WriteFile(configPath, configJSON, 0600); err == nil {
							env = append(env, fmt.Sprintf("DOCKER_CONFIG=%s", tmpDir))
							logger.Debug("configured Docker auth for syft",
								zap.String("configPath", configPath),
								zap.String("registry", registryName))
						}
					}
				}
			} else if authConfig.RegistryToken != "" {
				logger.Debug("setting up Docker config for syft with registry token")

				tmpDir, err := os.MkdirTemp("", "syft-docker-config")
				if err != nil {
					logger.Warn("failed to create temp directory for syft docker config", zap.Error(err))
				} else {
					defer os.RemoveAll(tmpDir)

					// Get the normalized registry name
					registryName := normalizeRegistryNameForDockerConfig(registry)

					// For registry tokens, use the auth field with base64 encoding
					// Docker expects username:token format, for anonymous token access we use empty username
					authValue := base64.StdEncoding.EncodeToString([]byte(":" + authConfig.RegistryToken))
					dockerConfig := map[string]interface{}{
						"auths": map[string]interface{}{
							registryName: map[string]interface{}{
								"auth": authValue,
							},
						},
					}

					configJSON, err := json.Marshal(dockerConfig)
					if err == nil {
						configPath := tmpDir + "/config.json"
						if err := os.WriteFile(configPath, configJSON, 0600); err == nil {
							env = append(env, fmt.Sprintf("DOCKER_CONFIG=%s", tmpDir))
							logger.Debug("configured Docker token auth for syft",
								zap.String("configPath", configPath),
								zap.String("registry", registryName))
						} else {
							logger.Warn("failed to write Docker config file", zap.Error(err))
						}
					} else {
						logger.Warn("failed to marshal Docker config", zap.Error(err))
					}
				}
			} else {
				logger.Debug("no authentication credentials available for syft")
			}
		}
	} else {
		imageRef := registry + "/" + imageName + "@" + digest
		if isAnonDockerHub {
			logger.Debug("skipping authentication for public Docker Hub image", zap.String("imageRef", imageRef))
		} else {
			logger.Debug("using anonymous authentication for syft", zap.String("imageRef", imageRef))
		}
	}

	// Create temp directory for syft outputs
	outputDir, tmpErr := os.MkdirTemp("", "syft-outputs")
	if tmpErr != nil {
		return "", 0, "", fmt.Errorf("failed to create temp dir for syft outputs: %w", tmpErr)
	}
	defer os.RemoveAll(outputDir)

	spdxPath := outputDir + "/sbom.spdx.json"
	syftPath := outputDir + "/sbom.syft.json"

	// Build syft command with multiple outputs in one run
	cmd := exec.CommandContext(syftCtx, "syft",
		"--platform", platform,
		"-o", "syft-json="+syftPath,
		"-o", "spdx-json="+spdxPath,
		"registry:"+registry+"/"+imageName+"@"+digest,
	)

	cmd.Env = env

	// Capture both stdout and stderr
	var stdout, stderrBuf bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderrBuf

	logger.Debug("executing syft command", zap.String("command", cmd.String()))

	// Execute the command
	err = cmd.Run()
	if err != nil {
		if stderrStr := stderrBuf.String(); stderrStr != "" {
			return "", 0, "", fmt.Errorf("syft generation failed for image %s@%s: %w", imageName, digest, errors.New(stderrStr))
		}
		return "", 0, "", fmt.Errorf("syft generation failed for image %s@%s: %w", imageName, digest, err)
	}

	// Read SBOM from spdx-json output file
	spdxBytes, readErr := os.ReadFile(spdxPath)
	if readErr != nil {
		return "", 0, "", fmt.Errorf("failed to read spdx-json output: %w", readErr)
	}

	// Validate that it's valid JSON
	var sbomData interface{}
	if err := json.Unmarshal(spdxBytes, &sbomData); err != nil {
		return "", 0, "", fmt.Errorf("syft produced invalid JSON: %w", err)
	}

	// Read syft-json output to extract image size and image digest
	syftBytes, readSyftErr := os.ReadFile(syftPath)
	if readSyftErr == nil {
		type syftJSONMetadata struct {
			Source struct {
				Metadata struct {
					ImageSize      int64  `json:"imageSize"`
					ManifestDigest string `json:"manifestDigest"`
				} `json:"metadata"`
			} `json:"source"`
		}
		var sj syftJSONMetadata
		if err := json.Unmarshal(syftBytes, &sj); err == nil {
			imageSizeBytes = sj.Source.Metadata.ImageSize
			imageDigest = sj.Source.Metadata.ManifestDigest
		}
	}

	return string(spdxBytes), imageSizeBytes, imageDigest, nil
}

// isDockerHub checks if the registry is Docker Hub
func isDockerHub(registry string) bool {
	return registry == "index.docker.io"
}

// normalizeRegistryNameForDockerConfig normalizes registry names for Docker config.json
// Docker config expects specific formats for different registries
func normalizeRegistryNameForDockerConfig(registry string) string {
	// For Docker Hub, use the standard format expected by Docker config
	if isDockerHub(registry) {
		return "https://index.docker.io/v1/"
	}

	// For other registries, use the registry name as-is
	// but ensure it has https:// prefix if it doesn't already
	if !strings.HasPrefix(registry, "http") {
		return "https://" + registry
	}

	return registry
}

// getDockerHubAuth gets an authentication token from Docker Hub
func getDockerHubAuth(ctx context.Context, repository string) (authn.Authenticator, error) {
	// Handle library images (e.g., "nginx" -> "library/nginx")
	if !strings.Contains(repository, "/") {
		repository = "library/" + repository
	}

	// Construct the Docker Hub auth URL
	authURL := fmt.Sprintf("https://auth.docker.io/token?service=registry.docker.io&scope=repository:%s:pull", repository)

	logger.Info("requesting Docker Hub token",
		zap.String("repository", repository),
		zap.String("authURL", authURL))

	// Create HTTP client with timeout
	client := &http.Client{Timeout: 30 * time.Second}

	req, err := http.NewRequestWithContext(ctx, "GET", authURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create auth request: %w", err)
	}

	req.Header.Set("User-Agent", "SecureBuild/1.0")

	// Make the request
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to request Docker Hub token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Docker Hub auth returned status %d: %s", resp.StatusCode, string(body))
	}

	// Parse the response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read auth response: %w", err)
	}

	var tokenResp DockerHubTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse auth response: %w", err)
	}

	token := tokenResp.Token
	if token == "" {
		token = tokenResp.AccessToken
	}

	if token == "" {
		return nil, fmt.Errorf("no token received from Docker Hub auth")
	}

	logger.Info("successfully obtained Docker Hub token")

	// Return an authenticator with the token
	return authn.FromConfig(authn.AuthConfig{
		RegistryToken: token,
	}), nil
}
