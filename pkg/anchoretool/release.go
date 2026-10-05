package anchoretool

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/sigstore/cosign/v2/pkg/cosign"
	"github.com/sigstore/cosign/v2/pkg/oci/static"
	rekorclient "github.com/sigstore/rekor/pkg/client"
	"github.com/sigstore/sigstore/pkg/cryptoutils"
)

const (
	certificateIssuer = "https://token.actions.githubusercontent.com"
	rekorURL          = "https://rekor.sigstore.dev"
	maxMetadataBytes  = 10 << 20
	maxArchiveBytes   = 512 << 20
	maxBinaryBytes    = 256 << 20
)

type Tool struct {
	Name       string
	ModulePath string
	Repository string
}

var (
	Grype = Tool{Name: "grype", ModulePath: "github.com/anchore/grype", Repository: "anchore/grype"}
	Syft  = Tool{Name: "syft", ModulePath: "github.com/anchore/syft", Repository: "anchore/syft"}
)

type Release struct {
	Binary  []byte
	Version string
}

type releaseLoad struct {
	done    chan struct{}
	release Release
	err     error
}

var (
	releaseHTTPClient = &http.Client{Timeout: 2 * time.Minute}
	releaseCacheMu    sync.Mutex
	releaseCache      = map[string]Release{}
	releaseLoads      = map[string]*releaseLoad{}
)

// Version returns the version of an Anchore CLI from the worker's Go build
// metadata. The module requirements in go.mod are the single version source.
func Version(tool Tool) (string, error) {
	buildInfo, ok := debug.ReadBuildInfo()
	if !ok {
		return "", errors.New("Go build metadata is unavailable")
	}
	for _, dep := range buildInfo.Deps {
		if dep.Path == tool.ModulePath {
			if dep.Replace != nil {
				dep = dep.Replace
			}
			if dep.Version == "" || dep.Version == "(devel)" {
				return "", fmt.Errorf("module %s has no release version", tool.ModulePath)
			}
			return strings.TrimPrefix(dep.Version, "v"), nil
		}
	}
	return "", fmt.Errorf("module %s is missing from Go build metadata", tool.ModulePath)
}

// Load downloads a release archive, verifies Anchore's keyless signature on
// its checksum manifest, verifies the archive checksum, and extracts the CLI.
// Successfully verified releases are cached in the worker process.
func Load(ctx context.Context, tool Tool, goos, goarch string) (Release, error) {
	version, err := Version(tool)
	if err != nil {
		return Release{}, fmt.Errorf("resolve %s version: %w", tool.Name, err)
	}
	asset, err := assetName(tool, version, goos, goarch)
	if err != nil {
		return Release{}, err
	}

	cacheKey := tool.Name + "/" + version + "/" + goos + "/" + goarch
	return loadCachedRelease(ctx, cacheKey, func(ctx context.Context) (Release, error) {
		return loadRelease(ctx, tool, version, asset)
	})
}

func loadCachedRelease(ctx context.Context, cacheKey string, loader func(context.Context) (Release, error)) (Release, error) {
	releaseCacheMu.Lock()
	if cached, ok := releaseCache[cacheKey]; ok {
		releaseCacheMu.Unlock()
		return cached, nil
	}
	if active, ok := releaseLoads[cacheKey]; ok {
		releaseCacheMu.Unlock()
		select {
		case <-active.done:
			return active.release, active.err
		case <-ctx.Done():
			return Release{}, ctx.Err()
		}
	}
	active := &releaseLoad{done: make(chan struct{})}
	releaseLoads[cacheKey] = active
	releaseCacheMu.Unlock()

	active.release, active.err = loader(ctx)

	releaseCacheMu.Lock()
	delete(releaseLoads, cacheKey)
	if active.err == nil {
		releaseCache[cacheKey] = active.release
	}
	close(active.done)
	releaseCacheMu.Unlock()
	return active.release, active.err
}

func loadRelease(ctx context.Context, tool Tool, version, asset string) (Release, error) {
	baseURL := fmt.Sprintf("https://github.com/%s/releases/download/v%s", tool.Repository, version)
	checksumsName := fmt.Sprintf("%s_%s_checksums.txt", tool.Name, version)

	checksums, err := download(ctx, baseURL+"/"+checksumsName, maxMetadataBytes)
	if err != nil {
		return Release{}, err
	}
	certificate, err := download(ctx, baseURL+"/"+checksumsName+".pem", maxMetadataBytes)
	if err != nil {
		return Release{}, err
	}
	signature, err := download(ctx, baseURL+"/"+checksumsName+".sig", maxMetadataBytes)
	if err != nil {
		return Release{}, err
	}
	if err := verifyManifest(ctx, tool, checksums, certificate, signature); err != nil {
		return Release{}, fmt.Errorf("verify %s checksum manifest signature: %w", tool.Name, err)
	}

	expectedDigest, err := checksumForAsset(checksums, asset)
	if err != nil {
		return Release{}, fmt.Errorf("read %s checksum: %w", asset, err)
	}
	archive, err := download(ctx, baseURL+"/"+asset, maxArchiveBytes)
	if err != nil {
		return Release{}, err
	}
	if err := verifyChecksum(archive, expectedDigest); err != nil {
		return Release{}, fmt.Errorf("verify %s checksum: %w", asset, err)
	}
	binary, err := extractBinary(archive, tool.Name)
	if err != nil {
		return Release{}, fmt.Errorf("extract %s: %w", asset, err)
	}
	return Release{Binary: binary, Version: version}, nil
}

func assetName(tool Tool, version, goos, goarch string) (string, error) {
	if goos != "linux" && goos != "darwin" {
		return "", fmt.Errorf("%s installation is unsupported on %s/%s", tool.Name, goos, goarch)
	}
	if goarch != "amd64" && goarch != "arm64" {
		return "", fmt.Errorf("%s installation is unsupported on %s/%s", tool.Name, goos, goarch)
	}
	return fmt.Sprintf("%s_%s_%s_%s.tar.gz", tool.Name, version, goos, goarch), nil
}

func download(ctx context.Context, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request for %s: %w", url, err)
	}
	resp, err := releaseHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download %s: unexpected HTTP status %s", url, resp.Status)
	}
	contents, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", url, err)
	}
	if int64(len(contents)) > limit {
		return nil, fmt.Errorf("download %s exceeds %d bytes", url, limit)
	}
	return contents, nil
}

func verifyManifest(ctx context.Context, tool Tool, manifest, certificate, signature []byte) error {
	certificate = bytes.TrimSpace(certificate)
	if decoded, err := base64.StdEncoding.DecodeString(string(certificate)); err == nil && bytes.Contains(decoded, []byte("BEGIN CERTIFICATE")) {
		certificate = decoded
	}
	certificates, err := cryptoutils.UnmarshalCertificatesFromPEM(certificate)
	if err != nil {
		return fmt.Errorf("parse signing certificate: %w", err)
	}
	if len(certificates) != 1 {
		return fmt.Errorf("expected one signing certificate, got %d", len(certificates))
	}

	signature = bytes.TrimSpace(signature)
	if _, err := base64.StdEncoding.DecodeString(string(signature)); err != nil {
		signature = []byte(base64.StdEncoding.EncodeToString(signature))
	}
	staticSignature, err := static.NewSignature(manifest, string(signature), static.WithCertChain(certificate, nil))
	if err != nil {
		return fmt.Errorf("load signature: %w", err)
	}
	trustedRoot, err := cosign.TrustedRoot()
	if err != nil {
		return fmt.Errorf("load Sigstore trusted root: %w", err)
	}
	rekor, err := rekorclient.GetRekorClient(rekorURL)
	if err != nil {
		return fmt.Errorf("create Rekor client: %w", err)
	}
	identity := certificateIdentity(tool)
	checkOptions := &cosign.CheckOpts{
		TrustedMaterial: trustedRoot,
		RekorClient:     rekor,
		Identities: []cosign.Identity{{
			Subject: identity,
			Issuer:  certificateIssuer,
		}},
	}
	_, err = cosign.VerifyBlobSignature(ctx, staticSignature, checkOptions)
	return err
}

func certificateIdentity(tool Tool) string {
	return fmt.Sprintf("https://github.com/%s/.github/workflows/release.yaml@refs/heads/main", tool.Repository)
}

func checksumForAsset(manifest []byte, asset string) (string, error) {
	for line := range strings.SplitSeq(string(manifest), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		name := strings.TrimPrefix(fields[1], "*")
		if name == asset {
			if len(fields[0]) != sha256.Size*2 {
				return "", fmt.Errorf("invalid SHA-256 digest for %s", asset)
			}
			if _, err := hex.DecodeString(fields[0]); err != nil {
				return "", fmt.Errorf("invalid SHA-256 digest for %s: %w", asset, err)
			}
			return strings.ToLower(fields[0]), nil
		}
	}
	return "", fmt.Errorf("asset is absent from signed checksum manifest")
}

func verifyChecksum(contents []byte, expected string) error {
	digest := sha256.Sum256(contents)
	actual := hex.EncodeToString(digest[:])
	if actual != strings.ToLower(expected) {
		return fmt.Errorf("digest mismatch: expected %s, got %s", expected, actual)
	}
	return nil
}

func extractBinary(archive []byte, binaryName string) ([]byte, error) {
	gzipReader, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, err
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		cleanName := path.Clean(header.Name)
		if header.Typeflag != tar.TypeReg || path.IsAbs(cleanName) || strings.HasPrefix(cleanName, "../") || path.Base(cleanName) != binaryName {
			continue
		}
		if header.Size < 0 || header.Size > maxBinaryBytes {
			return nil, fmt.Errorf("binary size %d is invalid", header.Size)
		}
		binary, err := io.ReadAll(io.LimitReader(tarReader, maxBinaryBytes+1))
		if err != nil {
			return nil, err
		}
		if int64(len(binary)) != header.Size {
			return nil, fmt.Errorf("binary size mismatch: expected %d, got %d", header.Size, len(binary))
		}
		return binary, nil
	}
	return nil, fmt.Errorf("binary %q is absent from archive", binaryName)
}

func VersionMatches(output, expected string) bool {
	expected = strings.TrimPrefix(expected, "v")
	for line := range strings.SplitSeq(output, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if ok && strings.EqualFold(strings.TrimSpace(key), "version") && strings.TrimPrefix(strings.TrimSpace(value), "v") == expected {
			return true
		}
	}
	return false
}
