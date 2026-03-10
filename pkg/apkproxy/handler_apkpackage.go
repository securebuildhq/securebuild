package apkproxy

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
	"github.com/securebuildhq/securebuild/pkg/listener"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
)

func handleAPKPackage(c *gin.Context) {
	arch := c.Param("arch")
	packageName := c.Param("package")

	ctx := c.Request.Context()

	s3Object, err := listener.GetAPKStream(ctx, packageName, arch)
	if err != nil {
		logger.Errorf("handleAPKPackage: failed to get APK stream: %s", err)
		c.Status(http.StatusInternalServerError)
		return
	}
	if s3Object == nil {
		logger.Errorf("handleAPKPackage: APK file not found")
		c.Status(http.StatusNotFound)
		return
	}
	defer s3Object.Body.Close()

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	id, err := securerandom.Hex(16)
	if err != nil {
		logger.Errorf("handleAPKPackage: failed to generate random ID: %s", err)
		c.Status(http.StatusInternalServerError)
		return
	}

	query := `
		INSERT INTO apk_pull (id, package_name, arch, pull_time)
		VALUES ($1, $2, $3, NOW())
	`
	_, err = conn.Exec(c.Request.Context(), query, id, packageName, arch)
	if err != nil {
		logger.Errorf("handleAPKPackage: failed to record APK pull: %s", err)
		c.Status(http.StatusInternalServerError)
		return
	}

	// Set response headers from S3 metadata
	setS3ResponseHeaders(c, s3Object, packageName)

	logger.Debugf("handleAPKPackage: streaming APK %s from S3", packageName)

	// Stream the body directly to the client
	c.Status(http.StatusOK)
	_, err = io.Copy(c.Writer, s3Object.Body)
	if err != nil {
		logger.Errorf("handleAPKPackage: failed to stream APK: %s", err)
		return
	}
}

func handleHeadAPKPackage(c *gin.Context) {
	arch := c.Param("arch")
	packageName := c.Param("package")

	ctx := c.Request.Context()

	s3Object, err := listener.GetAPKStream(ctx, packageName, arch)
	if err != nil {
		logger.Errorf("handleHeadAPKPackage: failed to get APK stream: %s", err)
		c.Status(http.StatusInternalServerError)
		return
	}
	if s3Object == nil {
		logger.Errorf("handleHeadAPKPackage: APK file not found")
		c.Status(http.StatusNotFound)
		return
	}
	defer s3Object.Body.Close()

	// Note: We don't record HEAD requests in the database to avoid pollution
	// Only actual downloads (GET requests) are tracked

	// Set the same headers as the GET request would
	setS3ResponseHeaders(c, s3Object, packageName)

	logger.Debugf("handleHeadAPKPackage: returning headers for APK %s", packageName)
	c.Status(http.StatusOK)
}

func parseAPKPackageName(packageName string) (string, string, int, error) {
	// bash-5.2.37-r33.apk
	// bash, 5.2.37, 33

	// baselayout-20230201-r41
	// baselayout, 20230201, 41

	// some packages have - in the name

	// remove the file extension
	packageName = strings.TrimSuffix(packageName, ".apk")

	parts := strings.Split(packageName, "-")
	if len(parts) < 3 {
		return "", "", 0, fmt.Errorf("invalid package name: %s", packageName)
	}

	// the last part is the release
	release := parts[len(parts)-1]

	// the second to last part is the version
	version := parts[len(parts)-2]

	// the remaining parts are the name
	name := strings.Join(parts[:len(parts)-2], "-")

	// remove the r from the release
	release = strings.TrimPrefix(release, "r")
	releaseInt, err := strconv.Atoi(release)
	if err != nil {
		return "", "", 0, fmt.Errorf("invalid release: %s", parts[2])
	}

	return name, version, releaseInt, nil
}

// setS3ResponseHeaders sets HTTP response headers from S3 GetObjectOutput metadata
// This includes content info, caching headers, checksums, and the specified filename
func setS3ResponseHeaders(c *gin.Context, s3Object *s3.GetObjectOutput, filename string) {
	// Content-Type
	if s3Object.ContentType != nil {
		c.Header("Content-Type", *s3Object.ContentType)
	}

	// Content-Length
	if s3Object.ContentLength != nil {
		c.Header("Content-Length", fmt.Sprintf("%d", *s3Object.ContentLength))
	}

	// Content-Encoding
	if s3Object.ContentEncoding != nil {
		c.Header("Content-Encoding", *s3Object.ContentEncoding)
	}

	// ETag for caching
	if s3Object.ETag != nil {
		c.Header("ETag", *s3Object.ETag)
	}

	// Last-Modified for caching
	if s3Object.LastModified != nil {
		c.Header("Last-Modified", s3Object.LastModified.Format(http.TimeFormat))
	}

	// Expiration
	if s3Object.Expires != nil {
		c.Header("Expires", s3Object.Expires.Format(http.TimeFormat))
	}

	// Cache-Control
	if s3Object.CacheControl != nil {
		c.Header("Cache-Control", *s3Object.CacheControl)
	}

	// Checksum headers for integrity verification
	if s3Object.ChecksumCRC32 != nil {
		c.Header("X-Amz-Checksum-CRC32", *s3Object.ChecksumCRC32)
	}
	if s3Object.ChecksumCRC32C != nil {
		c.Header("X-Amz-Checksum-CRC32C", *s3Object.ChecksumCRC32C)
	}
	if s3Object.ChecksumSHA1 != nil {
		c.Header("X-Amz-Checksum-SHA1", *s3Object.ChecksumSHA1)
	}
	if s3Object.ChecksumSHA256 != nil {
		c.Header("X-Amz-Checksum-SHA256", *s3Object.ChecksumSHA256)
	}

	// Note: Accept-Ranges header is intentionally omitted as we don't support range requests.
	// We always stream the full file from S3 to avoid range request billing DoS attacks.

	// Content-Disposition with the specified filename
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
}
