package apk

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/securebuildhq/securebuild/pkg/param"
)

func SignAPKIndex(ctx context.Context, pathToIndexTarGz string) error {
	fmt.Printf("DEBUG: Starting to sign APKINDEX at %s\n", pathToIndexTarGz)

	// Read the unsigned APKINDEX.tar.gz (original file)
	unsignedData, err := os.ReadFile(pathToIndexTarGz)
	if err != nil {
		return fmt.Errorf("failed to read index file: %w", err)
	}

	// Get private key
	privateKey, err := getPrivateKey(ctx)
	if err != nil {
		return fmt.Errorf("failed to get private key: %w", err)
	}

	// Step 1: Sign the ENTIRE unsigned APKINDEX.tar.gz file (like abuild-sign does)
	signature, err := createAPKSignature(unsignedData, privateKey)
	if err != nil {
		return fmt.Errorf("failed to create signature: %w", err)
	}

	fmt.Printf("DEBUG: Created signature of entire file: %d bytes\n", len(signature))

	// Step 2: Create signature tar.gz (contains ONLY the signature file)
	keyName := param.GetParam(ctx).APKPublicKeyName
	if strings.HasSuffix(keyName, ".rsa.pub") {
		keyName = strings.TrimSuffix(keyName, ".rsa.pub")
	}

	signatureFileName := fmt.Sprintf(".SIGN.RSA256.%s.rsa.pub", keyName)
	signatureTarGz, err := createSignatureTarGz(signature, signatureFileName)
	if err != nil {
		return fmt.Errorf("failed to create signature tar.gz: %w", err)
	}

	// Step 3: Concatenate signature.tar.gz + original.tar.gz (like abuild-sign does)
	var result bytes.Buffer
	result.Write(signatureTarGz) // First gzip stream (signature)
	result.Write(unsignedData)   // Second gzip stream (original APKINDEX)

	signedData := result.Bytes()

	// Write the signed version
	if err := os.WriteFile(pathToIndexTarGz, signedData, 0644); err != nil {
		return fmt.Errorf("failed to write signed index: %w", err)
	}

	return nil
}

// Create signature tar.gz containing ONLY the signature file (like abuild-sign)
func createSignatureTarGz(signature []byte, signatureFileName string) ([]byte, error) {
	var buf bytes.Buffer

	// Create gzip writer
	gzipWriter := gzip.NewWriter(&buf)
	tarWriter := tar.NewWriter(gzipWriter)

	now := time.Now().UTC()

	// Add ONLY the signature file (like abuild-sign does)
	sigHeader := &tar.Header{
		Name:     signatureFileName,
		Mode:     0644,
		Size:     int64(len(signature)),
		ModTime:  now,
		Typeflag: tar.TypeReg,
		Uid:      0, // --owner=0 like abuild-sign
		Gid:      0, // --group=0 like abuild-sign
	}

	if err := tarWriter.WriteHeader(sigHeader); err != nil {
		return nil, fmt.Errorf("failed to write signature header: %w", err)
	}

	if _, err := tarWriter.Write(signature); err != nil {
		return nil, fmt.Errorf("failed to write signature content: %w", err)
	}

	// Close tar writer - this adds the end-of-tar records
	if err := tarWriter.Close(); err != nil {
		return nil, fmt.Errorf("failed to close tar writer: %w", err)
	}

	// Close gzip writer
	if err := gzipWriter.Close(); err != nil {
		return nil, fmt.Errorf("failed to close gzip writer: %w", err)
	}

	// Now we need to "cut" the end-of-tar records (like abuild-tar --cut)
	fullTarGz := buf.Bytes()
	cutTarGz, err := cutEndOfTarRecords(fullTarGz)
	if err != nil {
		return nil, fmt.Errorf("failed to cut end-of-tar records: %w", err)
	}

	return cutTarGz, nil
}

// Remove end-of-tar records from a tar.gz (like abuild-tar --cut)
func cutEndOfTarRecords(tarGzData []byte) ([]byte, error) {
	// Decompress to find the end-of-tar records
	reader := bytes.NewReader(tarGzData)
	gzipReader, err := gzip.NewReader(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to decompress: %w", err)
	}
	defer gzipReader.Close()

	// Read all tar data
	tarData, err := io.ReadAll(gzipReader)
	if err != nil {
		return nil, fmt.Errorf("failed to read tar data: %w", err)
	}

	// Find and remove the last 1024 bytes (two 512-byte null records)
	if len(tarData) < 1024 {
		return nil, fmt.Errorf("tar data too short to cut end records")
	}

	// Check that the last 1024 bytes are indeed null (end-of-tar records)
	endRecords := tarData[len(tarData)-1024:]
	for i, b := range endRecords {
		if b != 0 {
			return nil, fmt.Errorf("expected null bytes at end of tar, found non-zero byte at position %d", i)
		}
	}

	// Remove the end-of-tar records
	cutTarData := tarData[:len(tarData)-1024]

	// Re-compress without the end-of-tar records
	var cutBuf bytes.Buffer
	cutGzipWriter := gzip.NewWriter(&cutBuf)
	if _, err := cutGzipWriter.Write(cutTarData); err != nil {
		return nil, fmt.Errorf("failed to write cut tar data: %w", err)
	}
	if err := cutGzipWriter.Close(); err != nil {
		return nil, fmt.Errorf("failed to close cut gzip writer: %w", err)
	}

	return cutBuf.Bytes(), nil
}

func getPrivateKey(ctx context.Context) (*rsa.PrivateKey, error) {
	privateSigningKey, err := base64.StdEncoding.DecodeString(param.GetParam(ctx).APKSigningKeyData)
	if err != nil {
		return nil, fmt.Errorf("failed to decode private signing key: %w", err)
	}

	// Parse the PEM encoded private key
	block, _ := pem.Decode(privateSigningKey)
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM block from private key")
	}

	var privateKey *rsa.PrivateKey
	switch block.Type {
	case "RSA PRIVATE KEY":
		privateKey, err = x509.ParsePKCS1PrivateKey(block.Bytes)
	case "PRIVATE KEY":
		parsedKey, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("failed to parse PKCS8 private key: %w", err)
		}
		var ok bool
		privateKey, ok = parsedKey.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("private key is not RSA")
		}
	default:
		return nil, fmt.Errorf("unsupported private key type: %s", block.Type)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	return privateKey, nil
}

func createAPKSignature(data []byte, privateKey *rsa.PrivateKey) ([]byte, error) {
	// Use SHA256 for RSA256 signatures (like abuild-sign with -t RSA256)
	hash := sha256.Sum256(data)

	// Sign the hash with PKCS1v15
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, hash[:])
	if err != nil {
		return nil, fmt.Errorf("failed to sign data: %w", err)
	}

	return signature, nil
}
