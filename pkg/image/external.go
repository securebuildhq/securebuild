package image

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

func GetImageExternalRegistry(ctx context.Context, id string) (*types.ImageExternalRegistry, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id, registry_url, username, password from image_external_registry where id = $1`
	row := conn.QueryRow(ctx, query, id)

	var registry types.ImageExternalRegistry
	var password string
	if err := row.Scan(&registry.ID, &registry.RegistryURL, &registry.Username, &password); err != nil {
		return nil, err
	}

	clearPassword, err := DecryptExternalRegistryPassword(ctx, password)
	if err != nil {
		return nil, err
	}

	registry.Password = clearPassword

	return &registry, nil
}

func ListImageExternalRegistries(ctx context.Context, imageID string) ([]types.ImageExternalRegistry, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select id, registry_url, username, password from image_external_registry where image_id = $1`
	rows, err := conn.Query(ctx, query, imageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	registries := []types.ImageExternalRegistry{}
	for rows.Next() {
		var registry types.ImageExternalRegistry
		var password string
		if err := rows.Scan(&registry.ID, &registry.RegistryURL, &registry.Username, &password); err != nil {
			return nil, err
		}

		registry.Password, err = DecryptExternalRegistryPassword(ctx, password)
		if err != nil {
			return nil, err
		}

		registries = append(registries, registry)
	}

	return registries, nil
}

func DecryptExternalRegistryPassword(ctx context.Context, password string) (string, error) {
	secret := param.GetParam(ctx).ExternalRegistryEncryptionSecret
	if secret == "" {
		return "", fmt.Errorf("external registry encryption secret is not set")
	}

	// base64 decode the secret if it is base64 encoded
	decodedSecret, err := base64.StdEncoding.DecodeString(secret)
	if err == nil {
		secret = string(decodedSecret)
	}

	// Base64 decode the input
	combined, err := base64.StdEncoding.DecodeString(password)
	if err != nil {
		return "", fmt.Errorf("failed to decode password: %w", err)
	}

	if len(combined) < 12 {
		return "", fmt.Errorf("invalid encrypted password format: combined length %d < 12", len(combined))
	}

	// Extract IV (first 12 bytes) and encrypted data (rest)
	iv := combined[:12]
	encryptedData := combined[12:]

	// Create a 32-byte key from the secret using SHA-256
	hash := sha256.Sum256([]byte(secret))
	key := hash[:]

	// Create AES cipher
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	// Create GCM mode
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	// Decrypt the data
	decrypted, err := gcm.Open(nil, iv, encryptedData, nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt password: %w", err)
	}

	return string(decrypted), nil
}
