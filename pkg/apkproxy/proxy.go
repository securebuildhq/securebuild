package apkproxy

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/securebuildhq/securebuild/pkg/datadog"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	gintrace "gopkg.in/DataDog/dd-trace-go.v1/contrib/gin-gonic/gin"
)

type APKProxy struct {
	baseCtx    context.Context
	listenAddr string
}

func NewAPKProxy(ctx context.Context, listenAddr string) (*APKProxy, error) {
	return &APKProxy{
		baseCtx:    ctx,
		listenAddr: listenAddr,
	}, nil
}

// enrichRequestContext middleware copies param and DBURI from baseCtx into each request context
func (p *APKProxy) enrichRequestContext() gin.HandlerFunc {
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

func StartProxy(ctx context.Context, listenAddr string) error {
	if listenAddr == "" {
		return fmt.Errorf("listenAddr parameter is required")
	}

	p, err := NewAPKProxy(ctx, listenAddr)
	if err != nil {
		return fmt.Errorf("failed to create proxy instance: %w", err)
	}

	gin.SetMode(gin.ReleaseMode)
	router := gin.Default()
	router.RedirectTrailingSlash = false
	router.RedirectFixedPath = false

	// Add Datadog APM tracing middleware if enabled
	if datadog.IsEnabled() {
		router.Use(gintrace.Middleware("securebuild-apk-proxy"))
	}

	router.Use(p.enrichRequestContext()) // Enrich request context with param and DBURI

	router.GET("/", func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		fmt.Println("auth", auth)
		c.JSON(http.StatusOK, gin.H{})
	})

	keyFilename := param.GetParam(ctx).APKPublicKeyName
	router.GET("/key/:keyName", func(c *gin.Context) {
		keyName := c.Param("keyName")
		if keyName != keyFilename {
			c.JSON(http.StatusNotFound, gin.H{"error": "Key not found"})
			return
		}

		decodedKeyData, err := base64.StdEncoding.DecodeString(param.GetParam(ctx).APKPublicKeyData)
		if err != nil {
			logger.Errorf("Failed to decode public key data: %s", err)
			c.Status(http.StatusInternalServerError)
			return
		}

		c.String(http.StatusOK, string(decodedKeyData))
	})

	// Add HEAD handler for /key/:keyName
	router.HEAD("/key/:keyName", func(c *gin.Context) {
		keyName := c.Param("keyName")
		if keyName != keyFilename {
			c.Status(http.StatusNotFound)
			return
		}

		decodedKeyData, err := base64.StdEncoding.DecodeString(param.GetParam(ctx).APKPublicKeyData)
		if err != nil {
			logger.Errorf("Failed to decode public key data: %s", err)
			c.Status(http.StatusInternalServerError)
			return
		}

		c.Header("Content-Type", "text/plain")
		c.Header("Content-Length", fmt.Sprintf("%d", len(decodedKeyData)))
		c.Status(http.StatusOK)
	})

	router.GET("/key", func(c *gin.Context) {
		decodedData, err := base64.StdEncoding.DecodeString(param.GetParam(ctx).APKPublicKeyData)
		if err != nil {
			logger.Errorf("Failed to decode public key data: %s", err)
			c.Status(http.StatusInternalServerError)
			return
		}

		filename := param.GetParam(ctx).APKPublicKeyName

		// Serve directly from memory without writing to disk
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
		c.Header("Content-Type", "application/x-pem-file") // or "text/plain"
		c.Data(http.StatusOK, "application/x-pem-file", decodedData)
	})

	// Add HEAD handler for /key
	router.HEAD("/key", func(c *gin.Context) {
		decodedData, err := base64.StdEncoding.DecodeString(param.GetParam(ctx).APKPublicKeyData)
		if err != nil {
			logger.Errorf("Failed to decode public key data: %s", err)
			c.Status(http.StatusInternalServerError)
			return
		}

		filename := param.GetParam(ctx).APKPublicKeyName

		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
		c.Header("Content-Type", "application/x-pem-file")
		c.Header("Content-Length", fmt.Sprintf("%d", len(decodedData)))
		c.Status(http.StatusOK)
	})

	// Alpine APK repository routes
	router.GET("/:arch/APKINDEX.tar.gz", handleGetAPKIndex)
	router.HEAD("/:arch/APKINDEX.tar.gz", handleHeadAPKIndex)
	router.GET("/alpine/:version/main/:arch/APKINDEX.tar.gz", handleGetAPKIndex)
	router.HEAD("/alpine/:version/main/:arch/APKINDEX.tar.gz", handleHeadAPKIndex)

	// package download (MUST be last - most generic route)
	router.GET("/:arch/:package", handleAPKPackage)
	router.HEAD("/:arch/:package", handleHeadAPKPackage)

	srv := &http.Server{
		Addr:    p.listenAddr,
		Handler: router,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	log.Printf("Proxy server started on %s", p.listenAddr)

	<-ctx.Done()

	log.Println("Shutting down proxy server...")
	if err := srv.Shutdown(context.Background()); err != nil {
		log.Printf("Server Shutdown Failed:%+v", err)
		return err
	}
	log.Println("Proxy server exited properly")

	return nil
}
