package cosign

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/securebuildhq/securebuild/pkg/logger"
	param "github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/registry"
	"go.uber.org/zap"
)

// cosignSign signs an image in a registry using cosign.
// imageRef: the full image reference (e.g., registry/repo:tag)
// base64PrivateKey: base64-encoded cosign private key
// cosignPassword: password for the cosign key (can be empty)
// registryUsername: registry username (e.g., serviceaccount)
// registryPassword: registry password/token
// extraEnv: any additional environment variables to append
func CosignSignWithKey(ctx context.Context, imageRef, base64PrivateKey, cosignPassword, registryUsername, registryPassword string) error {
	// Write the decoded private key to a temp file
	tmpDir, err := os.MkdirTemp("", "cosign-key")
	if err != nil {
		return fmt.Errorf("failed to create temp dir for cosign key: %w", err)
	}
	defer func() {
		privateKeyPath := filepath.Join(tmpDir, "cosign.key")
		_ = SecurelyDeleteFile(privateKeyPath)
		os.RemoveAll(tmpDir)
	}()

	privateKeyPath := filepath.Join(tmpDir, "cosign.key")
	decodedPrivateKey, err := base64.StdEncoding.DecodeString(base64PrivateKey)
	if err != nil {
		return fmt.Errorf("failed to decode cosign key: %w", err)
	}
	if !isPEM(decodedPrivateKey) {
		return fmt.Errorf("cosign key does not appear to be PEM format; check secret and encoding")
	}
	if err := os.WriteFile(privateKeyPath, decodedPrivateKey, 0600); err != nil {
		return fmt.Errorf("failed to write cosign key: %w", err)
	}

	// Build the upstream repository root where signatures should be pushed. We
	// never want cosign to push to the local OCI proxy (OCI_IMAGE_PREFIX). All
	// signature artifacts must be uploaded directly to the upstream registry.
	// We use RegistryImagePrefix as the root. The image name itself is *not*
	// included in this root; cosign will append it automatically.

	repoRoot := registry.NormalizePrefix(param.GetParam(ctx).RegistryImagePrefix)

	// Compose cosign sign command (no --repository flag, which is unsupported
	// in the currently vendored cosign version).  Instead, we rely on the
	// COSIGN_REPOSITORY environment variable to direct where signature layers
	// are pushed.
	cmd := exec.CommandContext(ctx, "cosign", "sign", "--allow-insecure-registry", "--key", privateKeyPath, "--yes", imageRef)

	// Base environment (scrubs any pre-existing COSIGN_REPOSITORY)
	env := buildCosignEnv(registryUsername, registryPassword, cosignPassword)
	// Derive "<slug>/<image>" from the image reference so that the signature
	// is pushed to the exact same repository as the image (just under the
	// upstream registry host).  Example:
	//   imageRef = "localhost:8888/securebuild-dev/zlib@sha256:…"
	//   imageRepo = "securebuild-dev/zlib"
	//   COSIGN_REPOSITORY = "registry.replicated.com/securebuild-dev/zlib"

	imageRefNoDigest := strings.SplitN(imageRef, "@", 2)[0]
	repoParts := strings.Split(imageRefNoDigest, "/")
	registryPrefix := registry.NormalizePrefix(param.GetParam(ctx).RegistryImagePrefix)
	if len(repoParts) >= 2 {
		imageName := repoParts[len(repoParts)-1]
		cosignRepo := registry.ImageRef(registryPrefix, imageName)
		env = append(env, fmt.Sprintf("COSIGN_REPOSITORY=%s", cosignRepo))
	} else {
		env = append(env, fmt.Sprintf("COSIGN_REPOSITORY=%s", repoRoot))
	}
	cmd.Env = env
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	if err != nil {
		return fmt.Errorf("cosign sign failed: %w (stderr: %s)", err, stderr.String())
	}
	return nil
}

// CosignAttest will attest the SBOM to the image
func CosignAttest(ctx context.Context, predicatePath, sbomLabel, digestRef, privateKeyPath string) error {
	//  Always check and fix double-encoded predicate as a safety measure
	sbomBytes, err := os.ReadFile(predicatePath)
	if err == nil {
		var test interface{}
		if err := json.Unmarshal(sbomBytes, &test); err == nil {
			// If the file is a string, unmarshal and rewrite as JSON object
			if str, ok := test.(string); ok {
				logger.Debug("Predicate file is a string, forcibly fixing double-encoding", zap.String("path", predicatePath))
				var obj interface{}
				if err := json.Unmarshal([]byte(str), &obj); err == nil {
					fixed, _ := json.MarshalIndent(obj, "", "  ")
					os.WriteFile(predicatePath, fixed, 0644)
					logger.Debug("Fixed predicate file double-encoding (forced)", zap.String("path", predicatePath))
					// Log the type after fix
					var verify interface{}
					if err := json.Unmarshal(fixed, &verify); err == nil {
						logger.Debug("Predicate file type after fix", zap.String("type", fmt.Sprintf("%T", verify)), zap.String("path", predicatePath))
					}
				}
			}
			// Even if not a string, log the type for debug
			logger.Debug("Predicate file type before cosign attest", zap.String("type", fmt.Sprintf("%T", test)), zap.String("path", predicatePath))
		}
	}
	// Set up environment for cosign authentication
	env := buildCosignEnv(param.GetParam(ctx).RegistryUsername, param.GetParam(ctx).RegistryPassword, param.GetParam(ctx).CosignPassword)
	attestSBOM := func(predicatePath, sbomLabel string) error {
		logger.Debug("attaching SBOM attestation", zap.String("ref", digestRef), zap.String("sbom", sbomLabel))
		cmd := exec.CommandContext(ctx, "cosign", "attest",
			"--predicate", predicatePath,
			"--key", privateKeyPath,
			"--type", PredicateSPDX,
			"--yes",
			digestRef)
		cmd.Env = env
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to attach %s SBOM attestation to %s: %w", sbomLabel, digestRef, err)
		}
		logger.Debug("successfully attached SBOM attestation", zap.String("ref", digestRef), zap.String("sbom", sbomLabel))
		return nil
	}
	return attestSBOM(predicatePath, sbomLabel)

}

func CosignDownloadAttestation(ctx context.Context, digestRef string) ([]byte, error) {
	env := buildCosignEnv("", "", "")
	cmd := exec.CommandContext(ctx, "cosign", "download", "attestation", digestRef)
	cmd.Env = env
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("cosign download attestation failed: %w (stderr: %s)", err, stderr.String())
	}
	return stdout.Bytes(), nil
}

// CosignTriangulate runs 'cosign triangulate' for the given imageRef and type ("signature" or "attest") and returns the reference as a string.
// where signature means the signature of the image (ex: cosign.sig)
// and attest means the attestations of the image (ex: sbom)
func CosignTriangulate(ctx context.Context, imageRef string, triangulateType string) (string, error) {
	env := buildCosignEnv("", "", "")
	cmd := exec.CommandContext(ctx, "cosign", "triangulate", "--type", triangulateType, imageRef)
	cmd.Env = env
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to triangulate %s digest: %w", triangulateType, err)
	}
	return string(output), nil
}

// CosignVerifyWithKey verifies that the provided image reference has a valid
// signature matching the supplied public key.  It returns an error if
// verification fails for any reason (missing signature, wrong key, etc.).
func CosignVerifyWithKey(ctx context.Context, imageRef, base64OrPEMPubKey, registryUsername, registryPassword string) error {
	// Write the public key to a temp file (accepts raw PEM or base64-encoded PEM).
	tmpDir, err := os.MkdirTemp("", "cosign-pub")
	if err != nil {
		return fmt.Errorf("failed to create temp dir for cosign pubkey: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	pubKeyPath := filepath.Join(tmpDir, "cosign.pub")

	var pemBytes []byte
	if bytes.HasPrefix([]byte(base64OrPEMPubKey), []byte("-----BEGIN")) {
		pemBytes = []byte(base64OrPEMPubKey)
	} else {
		decoded, decErr := base64.StdEncoding.DecodeString(base64OrPEMPubKey)
		if decErr != nil {
			return fmt.Errorf("public key is neither PEM nor base64-encoded PEM: %w", decErr)
		}
		pemBytes = decoded
	}

	if err := os.WriteFile(pubKeyPath, pemBytes, 0600); err != nil {
		return fmt.Errorf("failed to write pubkey: %w", err)
	}

	cmd := exec.CommandContext(ctx, "cosign", "verify", "--allow-insecure-registry", "--insecure-ignore-tlog", "--key", pubKeyPath, imageRef)
	cmd.Env = buildCosignEnv(registryUsername, registryPassword, "")
	var stderr bytes.Buffer
	cmd.Stdout = &bytes.Buffer{}
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("cosign verify failed: %w (stderr: %s)", err, stderr.String())
	}
	return nil
}

// isPEM checks if the decoded key looks like a PEM file
func isPEM(data []byte) bool {
	return len(data) >= 10 && string(data[:10]) == "-----BEGIN"
}

// buildCosignEnv constructs the environment variables for cosign commands
func buildCosignEnv(registryUsername, registryPassword, cosignPassword string) []string {
	// Start with a filtered copy of the current environment – drop any
	// pre-existing COSIGN_REPOSITORY variable to avoid altering the
	// docker-reference that cosign writes into the simple-signing payload.
	var env []string
	for _, e := range os.Environ() {
		if strings.HasPrefix(e, "COSIGN_REPOSITORY=") {
			continue // skip
		}
		env = append(env, e)
	}

	env = append(env,
		"SIGSTORE_NO_DEFAULT_TUF_ROOT=1",
		"COSIGN_EXPERIMENTAL=1",
		fmt.Sprintf("COSIGN_REGISTRY_USERNAME=%s", registryUsername),
		fmt.Sprintf("COSIGN_REGISTRY_PASSWORD=%s", registryPassword),
	)

	if cosignPassword != "" {
		env = append(env, fmt.Sprintf("COSIGN_PASSWORD=%s", cosignPassword))
	}

	return env
}
