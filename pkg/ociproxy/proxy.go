// Package ociproxy implements a *read-only* reverse proxy that sits in front of
// the upstream registry (registry.replicated.com).  Historically the builder
// pushed and signed images directly against the upstream and never contacted
// this proxy.  The key-based signing refactor introduced a new requirement:
//
//   1.  We *sign* the digest using the public host that end-users will consume
//       (OCI_IMAGE_PREFIX e.g. localhost:8888) so the simple-signing payload’s
//       `docker-reference` matches what `cosign verify` sees in production.
//   2.  We must still *push* the signature layer (the .sig OCI artifact) to the
//       upstream registry, **never** to the proxy.
//   3.  Immediately after signing the builder runs `cosign verify` against the
//       same digest to guarantee the signature it just produced can be
//       verified anonymously.
//
// Item 3 inevitably routes the read request through this proxy.  The code below
// therefore focuses on:
//
//   •  allowing anonymous GET/HEAD of the small artefacts (`/manifests/…sig`,
//      `/blobs/sha256:…`, `/referrers/…`) needed for verification while still
//      requiring auth for manifests/layers that contain the actual image.
//   •  translating the client path `/v2/<slug>/<image>/…` into the upstream
//      path `/v2/<slug>/<image>/…` **without** accidentally duplicating the
//      slug when the client already included it (build systems often embed the
//      slug twice).  The duplicate-slug guard below is generic – it uses
//      `imagePathPrefix` from runtime configuration and works for any
//      environment (dev, staging, prod).
//
// NOTE: The proxy never permits PUSH / PUT / DELETE and therefore cannot be
// abused to upload content.  All write operations continue to use direct
// upstream credentials.
//
// -----------------------------------------------------------------------------
// The remainder of this file contains:
//   • token management (DB-cached upstream JWTs)
//   • path-rewrite logic with duplicate-slug guard
//   • unauthenticated artefact allow-list & security middleware
// -----------------------------------------------------------------------------

package ociproxy

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1/remote/transport"
	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/datadog"
	sbimage "github.com/securebuildhq/securebuild/pkg/image"
	"github.com/securebuildhq/securebuild/pkg/oci"
	"github.com/securebuildhq/securebuild/pkg/param"

	ocidigest "github.com/opencontainers/go-digest"
	specs "github.com/opencontainers/image-spec/specs-go"
	ociv1 "github.com/opencontainers/image-spec/specs-go/v1"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/registry"
	"github.com/securebuildhq/securebuild/pkg/team"
	teamtypes "github.com/securebuildhq/securebuild/pkg/team/types"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
	gintrace "gopkg.in/DataDog/dd-trace-go.v1/contrib/gin-gonic/gin"
)

var proxyLogger *zap.SugaredLogger

// getClaims retrieves OCITokenClaims from Gin context
func getClaims(c *gin.Context) *OCITokenClaims {
	if claims, exists := c.Get("SecureBuild_Claims"); exists {
		if tokenClaims, ok := claims.(*OCITokenClaims); ok {
			return tokenClaims
		}
	}
	return nil
}

// Struct to hold proxy configuration and state, including the upstream token
type OCIProxy struct {
	baseCtx                 context.Context
	listenAddr              string
	upstreamRegistryBaseURL *url.URL
	imagePathPrefix         string
	upstreamStaticUser      string // e.g., "serviceaccount"
	upstreamStaticPassword  string // e.g., Replicated API Token used to GET the JWT

	mu          sync.Mutex
	tokenExpiry time.Time
	httpClient  *http.Client // For fetching token and proxying
}

// TokenResponse matches the expected JSON structure from the token endpoint
type TokenResponse struct {
	Token       string `json:"token"`
	AccessToken string `json:"access_token"` // Some registries use this
	ExpiresIn   int    `json:"expires_in"`   // Seconds
	IssuedAt    string `json:"issued_at"`
}

func NewOCIProxy(ctx context.Context, listenAddr, upstreamRegistryBaseURL, imagePathPrefix, upstreamStaticUser, upstreamStaticPassword string) (*OCIProxy, error) {
	// Accept values like "registry.replicated.com" or the full
	// "https://registry.replicated.com".  If the scheme is missing we
	// default to https so later code can safely build absolute URLs.
	fixedURL := upstreamRegistryBaseURL
	if !strings.Contains(fixedURL, "://") {
		fixedURL = "https://" + fixedURL
	}

	parsedURL, err := url.Parse(fixedURL)
	if err != nil {
		return nil, fmt.Errorf("invalid upstream registry base URL: %w", err)
	}

	// For bare hosts like "registry.replicated.com" Parse() puts the value in
	// the Path field; promote it to Host so that parsedURL.Host is never
	// empty later when we build /v2/token requests.
	if parsedURL.Host == "" && parsedURL.Path != "" {
		parsedURL.Host = parsedURL.Path
		parsedURL.Path = ""
	}

	// Create HTTP client with optional TLS skip verification for testing
	httpClient := &http.Client{Timeout: 30 * time.Second}
	p := param.GetParam(ctx)
	if p.OCIProxySkipTLSVerify {
		httpClient.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		}
	}

	return &OCIProxy{
		baseCtx:                 ctx,
		listenAddr:              listenAddr,
		upstreamRegistryBaseURL: parsedURL,
		imagePathPrefix:         imagePathPrefix,
		upstreamStaticUser:      upstreamStaticUser,
		upstreamStaticPassword:  upstreamStaticPassword,
		httpClient:              httpClient,
	}, nil
}

// enrichRequestContext middleware copies param and DBURI from baseCtx into each request context
func (p *OCIProxy) enrichRequestContext() gin.HandlerFunc {
	return func(c *gin.Context) {
		reqCtx := c.Request.Context()

		// Copy param from base context to request context
		// param contains DBURI, so no need to copy DBURI separately
		if paramValue := param.TryGetParam(p.baseCtx); paramValue != nil {
			reqCtx = param.WithParam(reqCtx, paramValue)
		}

		c.Request = c.Request.WithContext(reqCtx)
		c.Next()
	}
}

// StartProxy initializes and starts the OCI read-only proxy server.
func StartProxy(ctx context.Context, listenAddr string) error {
	if listenAddr == "" {
		return fmt.Errorf("listenAddr parameter is required")
	}

	// Initialize zap logger for the proxy
	logger, err := zap.NewProduction()
	if err != nil {
		return fmt.Errorf("failed to initialize zap logger: %w", err)
	}
	defer logger.Sync()
	proxyLogger = logger.Sugar()

	// Configuration (could be from env vars or config file)
	registryPrefix := registry.NormalizePrefix(param.GetParam(ctx).RegistryImagePrefix)
	upstreamRegistryURL := registry.HostFromPrefix(registryPrefix)
	imagePrefix := strings.TrimPrefix(registryPrefix, upstreamRegistryURL+"/")
	if imagePrefix == registryPrefix {
		imagePrefix = "" // prefix is host-only, no path
	}
	staticUser := param.GetParam(ctx).RegistryUsername
	staticPassword := param.GetParam(ctx).RegistryPassword

	p, err := NewOCIProxy(ctx, listenAddr, upstreamRegistryURL, imagePrefix, staticUser, staticPassword)
	if err != nil {
		return fmt.Errorf("failed to create proxy instance: %w", err)
	}

	gin.SetMode(gin.ReleaseMode)
	router := gin.Default()

	// Add Datadog APM tracing middleware if enabled
	if datadog.IsEnabled() {
		router.Use(gintrace.Middleware("securebuild-oci-proxy"))
	}

	router.Use(securityHeadersMiddleware()) // Add security headers to all responses
	router.Use(p.enrichRequestContext())    // Enrich request context with param and DBURI

	v2 := router.Group("/v2")
	{
		// Single catch-all route handles everything beneath /v2/ including the
		// registry "ping" (empty repoPath) and token endpoint.
		v2.Any("/*repoPath", func(c *gin.Context) {
			repoPath := strings.TrimPrefix(c.Param("repoPath"), "/") // e.g. securebuild-dev/zlib/manifests/...

			// Handle the /v2/token endpoint (no auth middleware for this)
			if repoPath == "token" {
				p.handleTokenRequest(c)
				return
			}

			// Apply auth middleware for all other endpoints
			p.customAuthMiddleware()(c)
			if c.IsAborted() {
				return
			}

			// Handle the OCI Registry "ping" endpoint (GET or HEAD /v2/)
			if repoPath == "" {
				if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
					c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "method not allowed"})
					return
				}
				c.Header("Docker-Distribution-API-Version", "registry/2.0")
				c.Header("OCI-Subject-Referrers-Support", "true")
				// Per Docker behaviour, respond with 200 and empty JSON body.
				c.JSON(http.StatusOK, gin.H{})
				proxyLogger.Infow("Responded to /v2/ ping with 200 OK after proxy authentication.")
				return
			}

			var repository, subpath string
			// Detect well-known OCI subpaths to accurately split repository from the remainder.
			// Order matters: manifests, referrers, blobs.
			if idx := strings.Index(repoPath, "/manifests/"); idx != -1 {
				repository = repoPath[:idx]
				subpath = repoPath[idx:]
			} else if idx := strings.Index(repoPath, "/referrers/"); idx != -1 {
				repository = repoPath[:idx]
				subpath = repoPath[idx:]
			} else if idx := strings.Index(repoPath, "/blobs/"); idx != -1 {
				repository = repoPath[:idx]
				subpath = repoPath[idx:]
			} else {
				// No subpath yet – treat the entire string as repository.
				repository = repoPath
				subpath = ""
			}

			if repository == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "repository name required"})
				return
			}

			if err := validateOCIRepositoryName(repository); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid repository name: " + err.Error()})
				return
			}

			// --- Serve legacy cosign .att/.sig/.sbom endpoints from DB (central handler) ---
			if handleLegacyCosignEndpoint(c) {
				return
			}

			if strings.HasPrefix(subpath, "/referrers/") {
				digest := strings.TrimPrefix(subpath, "/referrers/")
				if digest == "" {
					c.JSON(http.StatusBadRequest, gin.H{"error": "digest required"})
					return
				}
				if !strings.HasPrefix(digest, "sha256:") || len(digest) != 71 {
					c.JSON(http.StatusBadRequest, gin.H{"error": "invalid digest format"})
					return
				}
				// DB stores image name without global prefix; use last path segment
				dbRepo := repository
				if idx := strings.LastIndex(repository, "/"); idx != -1 {
					dbRepo = repository[idx+1:]
				}
				p.handleReferrers(c, dbRepo, digest)
				proxyLogger.Infow("handleReferrers invoked", "repository", dbRepo, "digest", digest)
				return
			}

			if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
				c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "method not allowed for this proxy"})
				return
			}

			isManifestByTag := strings.HasPrefix(subpath, "/manifests/") && !strings.Contains(subpath, "sha256:")

			// Check if the image is public first
			isPublic, err := sbimage.IsImagePublic(c.Request.Context(), repository)
			if err != nil {
				proxyLogger.Errorw("Error checking if image is public", "repository", repository, "err", err)
				c.Status(http.StatusInternalServerError)
				return
			}

			// If image is public, allow access without subscription check
			if !isPublic {
				claims := getClaims(c)
				if claims == nil {
					c.Status(http.StatusUnauthorized)
					return
				}
				ok, err := team.TeamHasAccessToImage(c.Request.Context(), claims.TeamID, repository)
				if err != nil {
					proxyLogger.Errorw("Error checking if team has access to image", "err", err)
					c.Status(http.StatusInternalServerError)
					return
				}

				if !ok {
					errorResponse := map[string]interface{}{
						"errors": []map[string]string{
							{
								"code":    "DENIED",
								"message": "You do not have an active subscription to this image. Visit securebuild.com to subscribe.",
								"detail":  "You do not have an active subscription to this image. Visit securebuild.com to subscribe.",
							},
						},
					}

					c.JSON(http.StatusForbidden, errorResponse)
					return
				}
			} else {
				proxyLogger.Infow("Allowing access to public image", "imageName", repository)
			}

			if isManifestByTag {
				tag := strings.TrimPrefix(subpath, "/manifests/")
				imageCatalogID, err := sbimage.GetImageCatalogID(c.Request.Context(), repository, tag)
				if err != nil {
					if err == sbimage.ErrImageNotFound {
						c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
						return
					}
					proxyLogger.Errorw("Error getting image catalog ID", "err", err)
					c.Status(http.StatusInternalServerError)
					return
				}

				// Record image pull for all users (including anonymous)
				claims := getClaims(c)
				if claims != nil {
					if err := team.RecordImagePull(c.Request.Context(), claims.TeamID, claims.Subject, imageCatalogID, repository, tag); err != nil {
						if err == team.ErrImageNotFound {
							c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
							return
						}
						proxyLogger.Errorw("Error recording image pull", "err", err)
						c.Status(http.StatusInternalServerError)
						return
					}

					if err := team.RecordTeamActivity(c.Request.Context(), team.RecordTeamActivityOpts{
						EventType:        teamtypes.ActivityEventTypeImagePull,
						TeamID:           claims.TeamID,
						ImageCatalogID:   imageCatalogID,
						ImageName:        repository,
						ImageTag:         tag,
						ServiceAccountID: claims.Subject,
					}); err != nil {
						proxyLogger.Errorw("Error recording team activity", "err", err)
						c.Status(http.StatusInternalServerError)
						return
					}
				}

				// Skip updating service account for anonymous access
				if claims != nil && !claims.IsAnonymous {
					if err := team.UpdateServiceAccountLastActive(c.Request.Context(), claims.Subject); err != nil {
						proxyLogger.Errorw("Error updating service account last active", "err", err)
						c.Status(http.StatusInternalServerError)
						return
					}
				}
			}

			p.proxyRequestHandler(c, repository)
		})
	}

	router.NoRoute(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "method not allowed"})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	})

	srv := &http.Server{
		Addr:    p.listenAddr,
		Handler: router,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			proxyLogger.Fatalf("listen: %s\n", err)
		}
	}()

	proxyLogger.Infow("Proxy server started", "listenAddr", p.listenAddr, "upstreamRegistryBaseURL", p.upstreamRegistryBaseURL.String(), "imagePathPrefix", p.imagePathPrefix)
	<-ctx.Done()

	proxyLogger.Warn("Shutting down proxy server...")
	if err := srv.Shutdown(context.Background()); err != nil {
		proxyLogger.Errorw("Server Shutdown Failed", "err", err)
		return err
	}
	proxyLogger.Warn("Proxy server exited properly")
	return nil
}

func (p *OCIProxy) fetchAndStoreUpstreamToken(ctx context.Context, jwtTokenID string, imageName string) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Construct the full repository reference for the upstream registry
	// Example: registry.replicated.com/securebuild-dev/pgvector-17
	var repoPath string
	if p.imagePathPrefix != "" {
		repoPath = fmt.Sprintf("%s/%s/%s", p.upstreamRegistryBaseURL.Host, p.imagePathPrefix, imageName)
	} else {
		repoPath = fmt.Sprintf("%s/%s", p.upstreamRegistryBaseURL.Host, imageName)
	}

	// Parse the repository reference
	repo, err := name.NewRepository(repoPath)
	if err != nil {
		return "", fmt.Errorf("failed to parse repository reference: %w", err)
	}

	proxyLogger.Infow("Fetching upstream token using transport.Exchange", "repository", repo.String())

	// Create base transport with TLS config if needed
	baseTransport := http.DefaultTransport
	if p.httpClient.Transport != nil {
		baseTransport = p.httpClient.Transport
	}

	// Create authenticator with static credentials
	auth := &authn.Basic{
		Username: p.upstreamStaticUser,
		Password: p.upstreamStaticPassword,
	}

	// Step 1: Ping the registry to get the auth challenge (WWW-Authenticate header with realm)
	challenge, err := transport.Ping(ctx, repo.Registry, baseTransport)
	if err != nil {
		return "", fmt.Errorf("failed to ping registry: %w", err)
	}

	// Step 2: Exchange credentials for JWT token using the realm from the challenge
	scopes := []string{repo.Scope(transport.PullScope)}
	token, err := transport.Exchange(ctx, repo.Registry, auth, baseTransport, scopes, challenge)
	if err != nil {
		return "", fmt.Errorf("failed to exchange credentials for token: %w", err)
	}

	actualToken := token.Token
	if actualToken == "" {
		return "", fmt.Errorf("received empty token from transport.Exchange")
	}

	// Store the token in the database
	if err := saveProxyToken(ctx, jwtTokenID, actualToken, imageName); err != nil {
		return "", fmt.Errorf("failed to store proxy token: %w", err)
	}

	// Calculate token expiry (e.g., 50 minutes if expires_in is 3000 seconds), allowing a small buffer
	expiryDuration := time.Duration(token.ExpiresIn)*time.Second - (1 * time.Minute)
	if token.ExpiresIn <= 60 { // if expiry is very short, use as is or a minimal duration
		expiryDuration = time.Duration(token.ExpiresIn) * time.Second / 2 // Use half for very short ones
	}
	if expiryDuration <= 0 { // Ensure it's not negative
		expiryDuration = 5 * time.Minute // Default to 5 mins if calculation is off
	}
	p.tokenExpiry = time.Now().Add(expiryDuration)

	proxyLogger.Infow("Successfully fetched and stored new upstream JWT", "expires_at", p.tokenExpiry.Format(time.RFC3339))
	return actualToken, nil
}

// extractJWTExpiration extracts the 'exp' claim from a JWT token
func extractJWTExpiration(jwtToken string) (time.Time, error) {
	// Split JWT into parts
	parts := strings.Split(jwtToken, ".")
	if len(parts) != 3 {
		return time.Time{}, fmt.Errorf("invalid JWT format: expected 3 parts, got %d", len(parts))
	}

	// Decode payload (second part) - assume valid base64
	payloadJSON, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return time.Time{}, fmt.Errorf("failed to decode JWT payload: %w", err)
	}

	// Parse JSON to extract exp claim
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return time.Time{}, fmt.Errorf("failed to unmarshal JWT claims: %w", err)
	}

	if claims.Exp == 0 {
		return time.Time{}, fmt.Errorf("no exp claim found in JWT")
	}

	return time.Unix(claims.Exp, 0), nil
}

func saveProxyToken(ctx context.Context, jwtTokenID string, upstreamToken string, imageName string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	id, err := securerandom.Hex(16)
	if err != nil {
		return fmt.Errorf("failed to generate random ID: %w", err)
	}

	now := time.Now()

	// Extract expiration from upstream JWT token
	expiresAt, err := extractJWTExpiration(upstreamToken)
	if err != nil {
		proxyLogger.Warnw("Failed to extract expiration from upstream token, using default", "err", err)
		// Fallback to 50 minutes if we can't parse the upstream token
		expiresAt = now.Add(50 * time.Minute)
	}

	query := `
	INSERT INTO proxy_token (id, token, created_at, expires_at, upstream_token, image_name)
	VALUES ($1, $2, $3, $4, $5, $6)
	`

	_, err = conn.Exec(ctx, query, id, jwtTokenID, now, expiresAt, upstreamToken, imageName)
	if err != nil {
		return fmt.Errorf("failed to insert proxy token: %w", err)
	}

	proxyLogger.Debugw("Stored upstream token in cache", "imageName", imageName, "jwtTokenID", jwtTokenID, "expiresAt", expiresAt.Format(time.RFC3339))
	return nil
}

var ErrNoUpstreamToken = errors.New("no upstream token found")

func getProxyToken(ctx context.Context, jwtTokenID string, imageName string) (string, error) {
	// Query cached upstream tokens by JWT token ID and image name
	// token column stores our JWT token ID, upstream_token stores the actual upstream JWT

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	// token column stores the JWT token ID (from our proxy)
	// upstream_token column stores the actual upstream JWT from registry.replicated.com
	// expires_at stores the expiry of the upstream JWT
	query := `
	SELECT upstream_token, expires_at
	FROM proxy_token
	WHERE token = $1 AND image_name = $2
	`
	proxyLogger.Debugw("DB_DEBUG: getProxyToken: Querying with jwtTokenID and imageName", "jwtTokenID", jwtTokenID, "imageName", imageName)

	var upstreamJWT string
	var expiresAt time.Time
	err := conn.QueryRow(ctx, query, jwtTokenID, imageName).Scan(&upstreamJWT, &expiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			proxyLogger.Debugw("DB_DEBUG: getProxyToken: No token found in DB for jwtTokenID and imageName. Returning ErrNoUpstreamToken.", "jwtTokenID", jwtTokenID, "imageName", imageName)
			return "", ErrNoUpstreamToken
		}
		proxyLogger.Errorw("DB_DEBUG: getProxyToken: DB query error for jwtTokenID and imageName", "jwtTokenID", jwtTokenID, "imageName", imageName, "err", err)
		return "", fmt.Errorf("failed to query proxy token: %w", err)
	}

	// Check expiry
	if time.Now().After(expiresAt.Add(-30 * time.Second)) { // 30-second buffer
		proxyLogger.Debugw("DB_DEBUG: getProxyToken: Token found in DB for jwtTokenID and imageName but it's EXPIRED. Returning ErrNoUpstreamToken.", "jwtTokenID", jwtTokenID, "imageName", imageName, "expires_at", expiresAt.Format(time.RFC3339))
		// Optionally, you could delete the expired token from DB here.
		return "", ErrNoUpstreamToken // Treat as not found if expired
	}

	proxyLogger.Debugw("DB_DEBUG: getProxyToken: Token found in DB for jwtTokenID and imageName and it's VALID.", "jwtTokenID", jwtTokenID, "imageName", imageName, "expires_at", expiresAt.Format(time.RFC3339))
	return upstreamJWT, nil
}

// deleteProxyToken removes a cached upstream JWT from the proxy_token table.
// It is invoked when the registry responds with HTTP 401, indicating that the
// token has been revoked or is otherwise invalid. Removing the row ensures the
// next request will fetch a fresh JWT instead of re-using the stale one.
func deleteProxyToken(ctx context.Context, jwtTokenID string, imageName string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	_, err := conn.Exec(ctx, `
	DELETE FROM proxy_token
	WHERE token = $1 AND image_name = $2
	`, jwtTokenID, imageName)
	if err != nil {
		return fmt.Errorf("failed to delete proxy token: %w", err)
	}
	return nil
}

func (p *OCIProxy) getUpstreamToken(ctx context.Context, jwtTokenID string, imageName string) (string, error) {
	// 1. Try to get from DB using JWT token ID
	cachedUpstreamJWT, err := getProxyToken(ctx, jwtTokenID, imageName)

	if err == nil {
		return cachedUpstreamJWT, nil
	}

	// If error is something other than ErrNoUpstreamToken, it's a real DB problem.
	if err != ErrNoUpstreamToken {
		return "", err // Return the actual DB error
	}

	// 2. Fetch new token from upstream and store it with the JWT token ID
	newUpstreamJWT, fetchErr := p.fetchAndStoreUpstreamToken(ctx, jwtTokenID, imageName)
	if fetchErr != nil {
		return "", fetchErr
	}

	return newUpstreamJWT, nil
}

func (p *OCIProxy) proxyRequestHandler(c *gin.Context, imageName string) {
	proxyLogger.Debugw("proxyRequestHandler called", "path", c.Request.URL.Path)

	// Verify authorization header exists (should be guaranteed by auth middleware)
	if c.Request.Header.Get("Authorization") == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
		return
	}

	// Treat unauthenticated clients as a distinct "anonymous" token owner so
	// that upstream JWTs can still be cached/reused internally.  The empty
	// string is sufficient – DB keys simply become ("", <imageName>).  This
	// avoids special-casing downstream logic.
	//
	// NOTE: do NOT mutate userToken when it is non-empty – it forms part of the
	// DB cache key for authenticated users.

	// Handle legacy .sig /.att /.sbom endpoints straight from the DB (works for
	// both authenticated and anonymous callers).
	if handleLegacyCosignEndpoint(c) {
		return
	}

	if serveArtifactManifestFromDB(c) {
		return
	}

	if serveArtifactBlobFromDB(c) {
		return
	}

	// Determine the repository name used for the upstream token scope.  The gin
	// router gives us only the *first* path component as imageName (e.g.
	// "securebuild-dev"), but the actual repository is usually
	// "<slug>/<image>", e.g. "securebuild-dev/zlib".  Parse the original
	// request path to capture the second component when present so the scope we
	// request from the upstream registry is correct and we avoid duplicate
	// segments like "securebuild-dev/securebuild-dev".
	fullRepoName := imageName // fallback
	if strings.HasPrefix(c.Request.URL.Path, "/v2/") {
		suffix := strings.TrimPrefix(c.Request.URL.Path, "/v2/")
		suffix = strings.TrimPrefix(suffix, "/") // remove leading slash if any

		// A request path can occasionally contain the slug twice, e.g.
		//   /v2/<slug>/<slug>/<image>/manifests/...
		// Normalise by collapsing the leading duplicate so we always derive
		// the repository scope "<slug>/<image>" exactly once.
		parts := strings.SplitN(suffix, "/", 4) // at most [slug] [maybe-slug] [image] [...]
		if len(parts) >= 2 {
			first := parts[0]
			second := parts[1]
			if first == p.imagePathPrefix && second == p.imagePathPrefix && len(parts) >= 3 {
				// Drop the duplicate slug so second segment becomes the image name.
				fullRepoName = parts[2]
			} else if first == p.imagePathPrefix {
				// Standard case: first is slug, second is image.
				fullRepoName = second
			}
		}
	}

	// Fetch (or reuse) an upstream JWT so we can proxy the request to the
	// backing registry using the JWT token ID from our authentication.
	claims := getClaims(c)
	if claims == nil {
		c.Status(http.StatusUnauthorized)
		return
	}
	upstreamToken, err := p.getUpstreamToken(c.Request.Context(), claims.ID, fullRepoName)
	if err != nil {
		proxyLogger.Errorw("Error getting upstream token for image", "image_name", imageName, "err", err)
		c.Status(http.StatusInternalServerError)
		return
	}

	director := func(req *http.Request) {
		req.URL.Scheme = p.upstreamRegistryBaseURL.Scheme
		req.URL.Host = p.upstreamRegistryBaseURL.Host
		req.Host = p.upstreamRegistryBaseURL.Host

		originalClientPath := c.Request.URL.Path
		targetUpstreamPath := originalClientPath

		if p.imagePathPrefix != "" && strings.HasPrefix(originalClientPath, "/v2/") {
			suffix := strings.TrimPrefix(originalClientPath, "/v2/")
			suffix = strings.TrimPrefix(suffix, "/")

			// Remove *extra* leading occurrences of the slug so we never emit
			//   /v2/<slug>/<slug>/<image>/...
			for strings.HasPrefix(suffix, p.imagePathPrefix+"/"+p.imagePathPrefix+"/") {
				suffix = strings.TrimPrefix(suffix, p.imagePathPrefix+"/")
			}

			if suffix != "" {
				if !strings.HasPrefix(suffix, p.imagePathPrefix+"/") {
					targetUpstreamPath = "/v2/" + p.imagePathPrefix + "/" + suffix
				} else {
					targetUpstreamPath = "/v2/" + suffix
				}
			}
		}
		req.URL.Path = targetUpstreamPath
		req.URL.RawQuery = c.Request.URL.RawQuery

		if upstreamToken != "" {
			req.Header.Set("Authorization", "Bearer "+upstreamToken)
		}

		proxyLogger.Debugw("Proxying client request to upstream", "clientPath", c.Request.URL.Path, "upstreamHost", req.URL.Host, "upstreamPath", req.URL.Path)
	}

	transport := &http.Transport{
		Proxy:              http.ProxyFromEnvironment,
		DisableCompression: true,
	}

	// Use the same TLS config as the proxy's HTTP client (for test environments)
	if p.httpClient.Transport != nil {
		if clientTransport, ok := p.httpClient.Transport.(*http.Transport); ok {
			transport.TLSClientConfig = clientTransport.TLSClientConfig
		}
	}

	// Store original upstream token before making the request, in case we need to retry with a fresh one
	// originalTokenForRequest := upstreamToken // This is now unused due to DB caching

	proxy := &httputil.ReverseProxy{
		Director:  director,
		Transport: transport,
		ErrorHandler: func(rw http.ResponseWriter, req *http.Request, err error) {
			proxyLogger.Errorw("http: proxy error", "err", err, "url", req.URL.String())
			rw.WriteHeader(http.StatusBadGateway)
		},
		ModifyResponse: func(resp *http.Response) error {
			proxyLogger.Infow("Upstream response status", "status", resp.Status, "url", resp.Request.URL.Host+resp.Request.URL.Path)

			// Inject OCI-Subject-Referrers-Support header for manifest responses
			if strings.Contains(resp.Request.URL.Path, "/manifests/") {
				resp.Header.Set("OCI-Subject-Referrers-Support", "true")
			}

			// If upstream returns 401, our JWT might have expired. Invalidate and try to fetch a new one next time.
			// Note: This simple retry is for the *next* request. A more robust solution might retry the current request.
			if resp.StatusCode == http.StatusUnauthorized {
				proxyLogger.Infow("Upstream returned 401, invalidating cached JWT for image", "image_name", imageName)
				if err := deleteProxyToken(resp.Request.Context(), claims.ID, imageName); err != nil {
					proxyLogger.Errorw("Failed to delete stale upstream JWT", "err", err)
				} else {
					proxyLogger.Debugw("Stale upstream JWT deleted; next request will fetch a fresh token", "image_name", imageName)
				}
			}

			if resp.StatusCode == http.StatusInternalServerError {
				bodyBytes, err := io.ReadAll(resp.Body)
				if err != nil {
					proxyLogger.Errorw("Error reading upstream 500 error response body", "err", err)
					// not much we can do here but return an empty body to client
					bodyBytes = []byte{}
				}
				resp.Body.Close()
				proxyLogger.Infow("Upstream 500 error response body", "body", string(bodyBytes))
				resp.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
				resp.ContentLength = int64(len(bodyBytes))
			}
			return nil
		},
	}

	proxy.ServeHTTP(c.Writer, c.Request)
}

// handleLegacyCosignEndpoint handles legacy cosign .att/.sig/.sbom endpoints from the DB.
// Returns true if the request was handled (response written), false otherwise.
func handleLegacyCosignEndpoint(c *gin.Context) bool {
	if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/v2/") {
			idx := strings.Index(path, "/manifests/")
			if idx != -1 {
				legacyName := path[idx+len("/manifests/"):]
				legacySuffixes := []struct {
					suffix       string
					artifactType string
				}{
					{".att", "application/vnd.in-toto+json"},
					{".sig", "application/vnd.dev.cosign.simplesigning.v1+json"},
					{".sbom", "application/vnd.cyclonedx+json"}, // adjust as needed
				}
				for _, entry := range legacySuffixes {
					if strings.HasSuffix(legacyName, entry.suffix) && strings.HasPrefix(legacyName, "sha256-") {
						imageDigest := "sha256:" + strings.TrimSuffix(strings.TrimPrefix(legacyName, "sha256-"), entry.suffix)
						ctx := c.Request.Context()
						manifests, err := oci.GetArtifactManifestsBySubjectDigest(ctx, imageDigest)
						if err == nil && len(manifests) > 0 {
							// For .att endpoints, return an OCI index containing ALL
							// matching attestation manifests. This allows cosign to
							// discover multiple attestation types (SBOM, SLSA provenance, etc.)
							// via the legacy tag-based lookup.
							if entry.suffix == ".att" {
								var descriptors []ociv1.Descriptor
								for _, m := range manifests {
									if m.ArtifactType != entry.artifactType {
										continue
									}
									descriptors = append(descriptors, ociv1.Descriptor{
										MediaType:    m.MediaType,
										Digest:       ocidigest.Digest(m.ID),
										Size:         m.ManifestSize,
										ArtifactType: m.ArtifactType,
									})
								}
								if len(descriptors) > 0 {
									proxyLogger.Infow("Serving legacy .att endpoint as OCI index from DB", "imageDigest", imageDigest, "count", len(descriptors))
									index := ociv1.Index{
										Versioned: specs.Versioned{SchemaVersion: 2},
										MediaType: MediaTypeImageIndex,
										Manifests: descriptors,
									}
									c.Header("Content-Type", MediaTypeImageIndex)
									c.Header("OCI-Subject-Referrers-Support", "true")
									c.JSON(http.StatusOK, index)
									return true
								}
							} else {
								// For .sig and .sbom endpoints, keep single-manifest selection.
								// Two different simple-signing manifests can
								// exist for the same image digest: a *keyed*
								// signature (verified with a public key) and a
								// *keyless* one (Fulcio cert inside).  The
								// legacy .sig endpoint must surface the keyed
								// variant so that `cosign verify --key` works.

								var keyedManifest *oci.ArtifactManifest
								var keylessManifest *oci.ArtifactManifest

								// Helper to decide if the manifest represents a
								// key-less signature based on the custom
								// annotation we attach at upload time.
								isKeyless := func(manifestBytes []byte) bool {
									var tmp struct {
										Annotations map[string]string `json:"annotations"`
										Layers      []struct {
											Annotations map[string]string `json:"annotations"`
										} `json:"layers"`
									}
									if err := json.Unmarshal(manifestBytes, &tmp); err != nil {
										return false // fail-open – treat as keyed
									}

									if v, ok := tmp.Annotations["dev.cosignproject.cosign/keyless"]; ok {
										return v == "true"
									}
									// Fall back to layer-level annotation (older
									// upload logic).
									if len(tmp.Layers) > 0 {
										if v, ok := tmp.Layers[0].Annotations["dev.cosignproject.cosign/keyless"]; ok {
											return v == "true"
										}
									}
									return false
								}

								for _, m := range manifests {
									if m.ArtifactType != entry.artifactType {
										continue
									}

									content, _, err := oci.GetArtifactBlobByDigest(ctx, m.ID)
									if err != nil || len(content) == 0 {
										continue
									}

									// Prefer the *keyed* manifest.  Remember the
									// first one seen as fallback.
									if isKeyless(content) {
										if keylessManifest == nil {
											km := m
											keylessManifest = &km
										}
									} else {
										if keyedManifest == nil {
											km := m
											keyedManifest = &km
										}
									}
								}

								// Always prefer key-less signature variant; fall back to keyed
								var chosen *oci.ArtifactManifest
								if keylessManifest != nil {
									chosen = keylessManifest
								} else if keyedManifest != nil {
									chosen = keyedManifest
								}

								if chosen != nil {
									content, mediaType, err := oci.GetArtifactBlobByDigest(ctx, chosen.ID)
									if err == nil && len(content) > 0 {
										proxyLogger.Infow("Serving legacy cosign endpoint (auto-selected) from DB", "endpoint", entry.suffix, "imageDigest", imageDigest, "artifactDigest", chosen.ID, "mediaType", mediaType)
										c.Header("Content-Type", mediaType)
										c.Header("OCI-Subject-Referrers-Support", "true")
										c.Writer.WriteHeader(http.StatusOK)
										c.Writer.Write(content)
										return true
									}
								}
							}
						}
						if err == nil && len(manifests) == 0 {
							proxyLogger.Debugw("No artifact manifests found for image digest (legacy endpoint)", "endpoint", entry.suffix, "imageDigest", imageDigest)
							c.Status(http.StatusNotFound)
							return true
						} else if err == nil {
							proxyLogger.Debugw("No matching artifact manifest found for legacy endpoint", "endpoint", entry.suffix, "imageDigest", imageDigest)
							c.Status(http.StatusNotFound)
							return true
						} else {
							proxyLogger.Errorw("DB error looking up artifact manifests for image digest (legacy endpoint)", "endpoint", entry.suffix, "imageDigest", imageDigest, "err", err)
							c.Status(http.StatusInternalServerError)
							return true
						}
					}
				}
			}
		}
	}
	return false
}

// serveArtifactManifestFromDB handles /v2/<repo>/manifests/<digest> requests for artifact manifests from the DB.
// Returns true if the request was handled (response written), false otherwise.
func serveArtifactManifestFromDB(c *gin.Context) bool {
	if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
		path := c.Request.URL.Path
		// Match /v2/<repo>/manifests/<digest>
		if strings.HasPrefix(path, "/v2/") {
			idx := strings.Index(path, "/manifests/")
			if idx != -1 {
				digest := path[idx+len("/manifests/"):]
				if strings.HasPrefix(digest, "sha256:") && len(digest) == 71 {
					ctx := c.Request.Context()
					content, mediaType, err := oci.GetArtifactBlobByDigest(ctx, digest)
					if err == nil && len(content) > 0 {
						proxyLogger.Infow("Serving artifact manifest from DB", "digest", digest, "mediaType", mediaType)
						c.Header("Content-Type", mediaType)
						c.Header("OCI-Subject-Referrers-Support", "true")
						c.Writer.WriteHeader(http.StatusOK)
						c.Writer.Write(content)
						return true
					} else if err == nil {
						proxyLogger.Debugw("Artifact manifest digest not found in DB (empty content)", "digest", digest)
					} else {
						proxyLogger.Debugw("Artifact manifest digest not found in DB", "digest", digest, "err", err)
					}
				}
			}
		}
	}
	return false
}

// serveArtifactBlobFromDB handles /v2/<repo>/blobs/<digest> requests for artifact blobs from the DB.
// Returns true if the request was handled (response written), false otherwise.
func serveArtifactBlobFromDB(c *gin.Context) bool {
	if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
		path := c.Request.URL.Path
		// Match /v2/<repo>/blobs/<digest>
		if strings.HasPrefix(path, "/v2/") {
			idx := strings.Index(path, "/blobs/")
			if idx != -1 {
				digest := path[idx+len("/blobs/"):]
				if strings.HasPrefix(digest, "sha256:") && len(digest) == 71 {
					ctx := c.Request.Context()
					content, mediaType, err := oci.GetArtifactBlobByDigest(ctx, digest)
					if err == nil && len(content) > 0 {
						proxyLogger.Infow("Serving artifact blob from DB", "digest", digest, "mediaType", mediaType)
						c.Header("Content-Type", mediaType)
						c.Writer.WriteHeader(http.StatusOK)
						c.Writer.Write(content)
						return true
					} else if err == nil {
						proxyLogger.Debugw("Artifact blob digest not found in DB (empty content)", "digest", digest)
					} else {
						proxyLogger.Debugw("Artifact blob digest not found in DB", "digest", digest, "err", err)
					}
				}
			}
		}
	}
	return false
}

// -----------------------------------------------------------------------------
// Authentication is now required for all endpoints
// -----------------------------------------------------------------------------

// generateWWWAuthenticateHeader creates a Bearer WWW-Authenticate header for OCI registry auth
func generateWWWAuthenticateHeader(c *gin.Context) string {
	scheme := c.Request.URL.Scheme
	if scheme == "" {
		scheme = "http" // fallback
	}
	host := c.Request.Host
	tokenRealm := fmt.Sprintf("%s://%s/v2/token", scheme, host)
	service := host
	return fmt.Sprintf(`Bearer realm="%s",service="%s"`, tokenRealm, service)
}

func (p *OCIProxy) customAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		authHeader := c.Request.Header.Get("Authorization")

		if authHeader == "" {
			// No auth header - return Bearer challenge with proper realm and service
			c.Header("WWW-Authenticate", generateWWWAuthenticateHeader(c))
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			return
		}

		// Handle Bearer token for all endpoints
		if strings.HasPrefix(authHeader, "Bearer ") {
			token := strings.TrimPrefix(authHeader, "Bearer ")

			// Validate the Bearer token
			claims, err := validateOCIToken(c.Request.Context(), token)
			if err != nil {
				c.Header("WWW-Authenticate", generateWWWAuthenticateHeader(c))
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
				return
			}

			// Store claims object in context for use in route handlers
			c.Set("SecureBuild_Claims", claims)

			if claims.IsAnonymous {
				// This is an anonymous token - extract repository from request path
				path := c.Request.URL.Path
				if strings.HasPrefix(path, "/v2/") {
					// Parse repository from path like /v2/repo/manifests/... or /v2/repo/blobs/...
					pathParts := strings.Split(strings.TrimPrefix(path, "/v2/"), "/")
					if len(pathParts) > 0 {
						requestedRepo := pathParts[0]
						// Remove image path prefix if present
						if p.imagePathPrefix != "" && strings.HasPrefix(requestedRepo, p.imagePathPrefix+"/") {
							requestedRepo = strings.TrimPrefix(requestedRepo, p.imagePathPrefix+"/")
						}

						// Check if the requested repository matches the allowed repository
						if requestedRepo == claims.Repository {
							// Verify the image is still public
							isPublic, err := sbimage.IsImagePublic(ctx, requestedRepo)
							if err != nil {
								proxyLogger.Errorw("Error checking if image is public", "repository", requestedRepo, "err", err)
								c.Header("WWW-Authenticate", generateWWWAuthenticateHeader(c))
								c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unable to verify image access"})
								return
							}

							if isPublic {
								// Allow anonymous access to public image
								proxyLogger.Debugw("Allowing anonymous access to public image", "repository", requestedRepo)
								c.Next()
								return
							}
						}
					}
				}

				// Anonymous token not valid for this request
				c.Header("WWW-Authenticate", generateWWWAuthenticateHeader(c))
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Anonymous token not valid for this resource"})
				return
			}

			// Regular authenticated token
			c.Next()
			return
		}

		// Handle Basic auth for other endpoints
		user, pass, ok := c.Request.BasicAuth()
		if !ok {
			// Return Bearer challenge with proper realm and service
			c.Header("WWW-Authenticate", generateWWWAuthenticateHeader(c))
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			return
		}

		conn := persistence.MustGetPooledPostgresSession(ctx)
		defer conn.Release()

		query := `
			select id as team_id from securebuild_team where registry_username = $1
		`

		var possibleTeamIDs []string
		rows, err := conn.Query(ctx, query, user)
		if err != nil {
			proxyLogger.Errorw("Error querying team ID", "err", err)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
			return
		}

		defer rows.Close()

		for rows.Next() {
			var teamID string
			if err := rows.Scan(&teamID); err != nil {
				proxyLogger.Errorw("Error scanning team ID", "err", err)
				c.AbortWithStatus(http.StatusInternalServerError)
				return
			}
			possibleTeamIDs = append(possibleTeamIDs, teamID)
		}

		if len(possibleTeamIDs) == 0 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
			return
		}

		var serviceAccount *teamtypes.ServiceAccount
		var serviceAccountTeamID string
		for _, teamID := range possibleTeamIDs {
			sa, err := team.FindServiceAccountWithValue(ctx, teamID, pass)
			if err != nil && !errors.Is(err, team.ErrServiceAccountNotFound) {
				proxyLogger.Errorw("Error finding service account", "err", err)
				c.AbortWithStatus(http.StatusInternalServerError)
				return
			}
			if errors.Is(err, team.ErrServiceAccountNotFound) {
				continue
			}
			serviceAccount = sa
			serviceAccountTeamID = teamID
			break
		}

		if serviceAccount == nil {
			// In the context of authentication/authorization middleware, you always want to write the response to the original context, not a copy.
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
			return
		}

		// Store service account info as claims-like object for Basic Auth
		basicAuthClaims := &OCITokenClaims{
			Subject:     serviceAccount.ID,
			TeamID:      serviceAccountTeamID,
			IsAnonymous: false,
		}
		c.Set("SecureBuild_Claims", basicAuthClaims)

		c.Next()
	}
}

// ---
// Security Headers and OCI Registry Spec
//
// The OCI Distribution Specification does not require or prohibit the use of additional HTTP security headers
// such as X-Content-Type-Options, X-Frame-Options, Referrer-Policy, or Content-Security-Policy.
// These headers are recommended by security best practices (e.g., OWASP Secure Headers Project) to mitigate
// attacks like MIME sniffing and clickjacking, especially for services exposed to browsers or the public internet.
//
// Adding these headers to your OCI registry/proxy responses is permitted and will not break OCI client compatibility.
//
// References:
//   - https://github.com/opencontainers/distribution-spec/blob/main/spec.md
//   - https://owasp.org/www-project-secure-headers/
//   - https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers
//
// ---
// securityHeadersMiddleware adds recommended security headers to all responses.
func securityHeadersMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("Content-Security-Policy", "default-src 'none'")
		c.Next()
	}
}

// handleTokenRequest handles the /v2/token endpoint for JWT token issuance
func (p *OCIProxy) handleTokenRequest(c *gin.Context) {
	// Get request parameters
	scope := c.Query("scope")
	service := c.Query("service")

	// Extract repository from scope if present
	var repository string
	if scope != "" && strings.HasPrefix(scope, "repository:") {
		// scope format: "repository:<repo>:pull"
		parts := strings.Split(scope, ":")
		if len(parts) >= 2 {
			repository = parts[1]
			// Remove the image path prefix if present to get the actual image name
			if p.imagePathPrefix != "" && strings.HasPrefix(repository, p.imagePathPrefix+"/") {
				repository = strings.TrimPrefix(repository, p.imagePathPrefix+"/")
			}
		}
	}

	// Check if this is an anonymous request (no auth header)
	user, pass, hasAuth := c.Request.BasicAuth()

	if !hasAuth {
		// Anonymous request - check if the requested repository is public
		if repository != "" {
			isPublic, err := sbimage.IsImagePublic(c.Request.Context(), repository)
			if err != nil {
				proxyLogger.Errorw("Error checking if image is public for anonymous token", "repository", repository, "err", err)
				c.Header("WWW-Authenticate", generateWWWAuthenticateHeader(c))
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unable to determine image access"})
				return
			}

			if isPublic {
				// Issue anonymous JWT token for public image
				proxyLogger.Infow("Issuing anonymous JWT token for public image", "repository", repository)

				now := time.Now()
				tokenID, err := securerandom.Hex(16)
				if err != nil {
					proxyLogger.Errorw("Failed to generate token ID", "err", err)
					c.Status(http.StatusInternalServerError)
					return
				}

				claims := OCITokenClaims{
					ID:          tokenID,
					Issuer:      c.Request.Host,
					Subject:     "anonymous",
					Audience:    service,
					ExpiresAt:   now.Add(1 * time.Hour).Unix(),
					IssuedAt:    now.Unix(),
					Scope:       scope,
					IsAnonymous: true,
					TeamID:      "anonymous",
					Repository:  repository,
				}

				token, err := generateOCIToken(c.Request.Context(), claims)
				if err != nil {
					proxyLogger.Errorw("Failed to generate anonymous JWT token", "err", err)
					c.Status(http.StatusInternalServerError)
					return
				}

				// Return token response
				response := TokenResponse{
					Token:     token,
					ExpiresIn: 3600, // 1 hour
					IssuedAt:  now.Format(time.RFC3339),
				}
				c.JSON(http.StatusOK, response)
				return
			}
		}

		// Not public or no repository specified - require authentication
		c.Header("WWW-Authenticate", generateWWWAuthenticateHeader(c))
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}

	// Authenticated request - validate credentials using the same logic as customAuthMiddleware
	ctx := c.Request.Context()
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		select id as team_id from securebuild_team where registry_username = $1
	`

	var possibleTeamIDs []string
	rows, err := conn.Query(ctx, query, user)
	if err != nil {
		proxyLogger.Errorw("Error querying team ID", "err", err)
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}
	defer rows.Close()

	for rows.Next() {
		var teamID string
		if err := rows.Scan(&teamID); err != nil {
			proxyLogger.Errorw("Error scanning team ID", "err", err)
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
		possibleTeamIDs = append(possibleTeamIDs, teamID)
	}

	if len(possibleTeamIDs) == 0 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	var serviceAccount *teamtypes.ServiceAccount
	var serviceAccountTeamID string
	for _, teamID := range possibleTeamIDs {
		sa, err := team.FindServiceAccountWithValue(ctx, teamID, pass)
		if err != nil && !errors.Is(err, team.ErrServiceAccountNotFound) {
			proxyLogger.Errorw("Error finding service account", "err", err)
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
		if errors.Is(err, team.ErrServiceAccountNotFound) {
			continue
		}
		serviceAccount = sa
		serviceAccountTeamID = teamID
		break
	}

	if serviceAccount == nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	// Generate authenticated JWT token
	now := time.Now()
	tokenID, err := securerandom.Hex(16)
	if err != nil {
		proxyLogger.Errorw("Failed to generate token ID", "err", err)
		c.Status(http.StatusInternalServerError)
		return
	}

	claims := OCITokenClaims{
		ID:          tokenID,
		Issuer:      c.Request.Host,
		Subject:     serviceAccount.ID,
		Audience:    service,
		ExpiresAt:   now.Add(1 * time.Hour).Unix(),
		IssuedAt:    now.Unix(),
		Scope:       scope,
		IsAnonymous: false,
		TeamID:      serviceAccountTeamID,
		Repository:  repository,
	}

	token, err := generateOCIToken(c.Request.Context(), claims)
	if err != nil {
		proxyLogger.Errorw("Failed to generate authenticated JWT token", "err", err)
		c.Status(http.StatusInternalServerError)
		return
	}

	// Return token response
	response := TokenResponse{
		Token:     token,
		ExpiresIn: 3600, // 1 hour
		IssuedAt:  now.Format(time.RFC3339),
	}
	c.JSON(http.StatusOK, response)
}
