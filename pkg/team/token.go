package team

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

const (
	// serviceAccountTokenPrefix is prepended to all service account tokens for leak detection
	serviceAccountTokenPrefix = "sbld_sa_"

	// algorithmSHA256 identifies SHA-256 hashed tokens
	algorithmSHA256 = "sha256"

	// algorithmBcrypt identifies bcrypt hashed tokens (legacy)
	algorithmBcrypt = "bcrypt"
)

// HashTokenSHA256 computes the SHA-256 hash of a token and returns it as base64-encoded string.
//
// This function is used both for generating hashes during token creation and for verifying
// presented tokens against stored hashes.
//
// Parameters:
//   - token: The full token string to hash
//
// Returns:
//   - The base64-encoded SHA-256 hash of the token
func hashTokenSHA256(token string) string {
	hasher := sha256.New()
	hasher.Write([]byte(token))
	hashBytes := hasher.Sum(nil)
	return base64.StdEncoding.EncodeToString(hashBytes)
}

// verifyTokenSHA256 verifies a presented token against a stored hash using the SHA-256 algorithm.
//
// Parameters:
//   - presentedToken: The token provided by the user/service
//   - storedHash: The hash stored in the database
//
// Returns:
//   - isValid: true if the token matches the stored hash
//   - error: Any error encountered during verification
func verifyTokenSHA256(presentedToken, storedHash string) (isValid bool, err error) {
	// Compute SHA-256 hash of presented token
	presentedHash := hashTokenSHA256(presentedToken)

	// Use constant-time comparison to prevent timing attacks
	// subtle.ConstantTimeCompare returns 1 if equal, 0 if not
	isValid = subtle.ConstantTimeCompare([]byte(presentedHash), []byte(storedHash)) == 1
	return isValid, nil
}

// verifyTokenBcrypt verifies a presented token against a stored hash using the bcrypt algorithm.
//
// Parameters:
//   - presentedToken: The token provided by the user/service
//   - storedHash: The hash stored in the database
//
// Returns:
//   - isValid: true if the token matches the stored hash
//   - error: Any error encountered during verification
func verifyTokenBcrypt(presentedToken, storedHash string) (isValid bool, err error) {
	// Use bcrypt's built-in comparison
	err = bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(presentedToken))
	if err == nil {
		// Token is valid and needs migration to SHA-256
		return true, nil
	}
	if err == bcrypt.ErrMismatchedHashAndPassword {
		// Token is invalid
		return false, nil
	}
	// Other bcrypt error
	return false, fmt.Errorf("bcrypt verification failed: %w", err)
}

// serviceAccountGetPartialValue extracts the first len(prefix) + 4 characters of a token for filtering if the
// token has the prefix, otherwise the first 4 characters
func serviceAccountGetPartialValue(token string) string {
	if strings.HasPrefix(token, serviceAccountTokenPrefix) {
		if len(token) >= len(serviceAccountTokenPrefix)+4 {
			return token[0 : len(serviceAccountTokenPrefix)+4]
		}
		return token
	}
	if len(token) >= 4 {
		return token[:4]
	}
	return token
}
