package apkproxy

import (
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/securebuildhq/securebuild/pkg/apk"
	"github.com/securebuildhq/securebuild/pkg/logger"
)

func handleHeadAPKIndex(c *gin.Context) {
	version := c.Param("version")
	arch := c.Param("arch")

	log.Printf("Received HEAD request for APKINDEX.tar.gz - version: %s, arch: %s", version, arch)

	ctx := c.Request.Context()

	// Get the APK index stream
	s3Object, err := apk.GetAPKIndexStream(ctx, arch)
	if err != nil {
		logger.Errorf("handleHeadAPKIndex: failed to get APK index stream: %v", err)
		c.Status(http.StatusInternalServerError)
		return
	}
	if s3Object == nil {
		logger.Errorf("handleHeadAPKIndex: APK index not found")
		c.Status(http.StatusNotFound)
		return
	}
	defer s3Object.Body.Close()

	// Set S3 response headers
	setS3ResponseHeaders(c, s3Object, "APKINDEX.tar.gz")

	c.Status(http.StatusOK)
}

func handleGetAPKIndex(c *gin.Context) {
	version := c.Param("version")
	arch := c.Param("arch")

	log.Printf("Received GET request for APKINDEX.tar.gz - version: %s, arch: %s", version, arch)

	auth := c.GetHeader("Authorization")
	fmt.Println("auth", auth)

	// Validate architecture
	if arch != "x86_64" && arch != "aarch64" {
		c.Status(http.StatusNotFound)
		return
	}

	ctx := c.Request.Context()

	// Get the APK index stream
	s3Object, err := apk.GetAPKIndexStream(ctx, arch)
	if err != nil {
		logger.Errorf("handleGetAPKIndex: failed to get APK index stream: %v", err)
		c.Status(http.StatusInternalServerError)
		return
	}
	if s3Object == nil {
		logger.Errorf("handleGetAPKIndex: APK index not found")
		c.Status(http.StatusNotFound)
		return
	}
	defer s3Object.Body.Close()

	// Set S3 response headers
	setS3ResponseHeaders(c, s3Object, "APKINDEX.tar.gz")

	logger.Debugf("handleGetAPKIndex: streaming APK index")

	// Stream the body directly to the client
	c.Status(http.StatusOK)
	_, err = io.Copy(c.Writer, s3Object.Body)
	if err != nil {
		logger.Errorf("handleGetAPKIndex: failed to stream APK index: %v", err)
		return
	}
}
