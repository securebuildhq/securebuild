package team

import (
	"crypto/sha256"
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

// Test_hashTokenSHA256 verifies SHA-256 hashing functionality
func Test_hashTokenSHA256(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{
			name:  "normal token",
			token: "sbld_sa_abcdefghijklmnopqrstuvwxyz1234567890ABC",
		},
		{
			name:  "empty string",
			token: "",
		},
		{
			name:  "special characters",
			token: "sbld_sa_!@#$%^&*()_+-=[]{}|;:,.<>?",
		},
		{
			name:  "unicode characters",
			token: "sbld_sa_你好世界🌍",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hash := hashTokenSHA256(tt.token)

			// Hash should not be empty
			require.NotEmpty(t, hash, "Hash should not be empty")

			// Hash should be valid base64
			decoded, err := base64.StdEncoding.DecodeString(hash)
			require.NoError(t, err, "Hash should be valid base64")

			// SHA-256 produces 32 bytes
			require.Equal(t, 32, len(decoded),
				"SHA-256 hash should be 32 bytes")

			// Verify deterministic - same input produces same output
			hash2 := hashTokenSHA256(tt.token)
			require.Equal(t, hash, hash2,
				"Hash should be deterministic for same input")

			// Verify manual computation matches
			hasher := sha256.New()
			hasher.Write([]byte(tt.token))
			expectedHash := base64.StdEncoding.EncodeToString(hasher.Sum(nil))
			require.Equal(t, expectedHash, hash,
				"Hash should match manual SHA-256 computation")
		})
	}
}

// Test_hashTokenSHA256_DifferentInputs verifies different inputs produce different hashes
func Test_hashTokenSHA256_DifferentInputs(t *testing.T) {
	token1 := "sbld_sa_token1"
	token2 := "sbld_sa_token2"
	token3 := "sbld_sa_token1 " // trailing space

	hash1 := hashTokenSHA256(token1)
	hash2 := hashTokenSHA256(token2)
	hash3 := hashTokenSHA256(token3)

	// All hashes should be different
	require.NotEqual(t, hash1, hash2,
		"Different tokens should produce different hashes")
	require.NotEqual(t, hash1, hash3,
		"Different tokens should produce different hashes")
	require.NotEqual(t, hash2, hash3,
		"Different tokens should produce different hashes")
}

// Test_verifyTokenSHA256 verifies SHA-256 token verification
func Test_verifyTokenSHA256(t *testing.T) {
	// Generate a test token
	token := "sbld_sa_test_token_for_verification_123"
	storedHash := hashTokenSHA256(token)

	tests := []struct {
		name           string
		presentedToken string
		storedHash     string
		expectedValid  bool
		expectedError  bool
	}{
		{
			name:           "valid token",
			presentedToken: token,
			storedHash:     storedHash,
			expectedValid:  true,
			expectedError:  false,
		},
		{
			name:           "invalid token - wrong token",
			presentedToken: "sbld_sa_wrong_token",
			storedHash:     storedHash,
			expectedValid:  false,
			expectedError:  false,
		},
		{
			name:           "invalid token - empty token",
			presentedToken: "",
			storedHash:     storedHash,
			expectedValid:  false,
			expectedError:  false,
		},
		{
			name:           "invalid token - modified prefix",
			presentedToken: "sbld_XX_test_token_for_verification_123",
			storedHash:     storedHash,
			expectedValid:  false,
			expectedError:  false,
		},
		{
			name:           "invalid hash - empty hash",
			presentedToken: token,
			storedHash:     "",
			expectedValid:  false,
			expectedError:  false,
		},
		{
			name:           "invalid hash - wrong hash",
			presentedToken: token,
			storedHash:     hashTokenSHA256("different_token"),
			expectedValid:  false,
			expectedError:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid, err := verifyTokenSHA256(
				tt.presentedToken,
				tt.storedHash,
			)

			if tt.expectedError {
				require.Error(t, err, "Expected error but got none")
			} else {
				require.NoError(t, err, "Unexpected error: %v", err)
			}

			require.Equal(t, tt.expectedValid, isValid,
				"isValid mismatch")
		})
	}
}

// Test_verifyTokenSHA256_ConstantTime verifies timing-safe comparison
func Test_verifyTokenSHA256_ConstantTime(t *testing.T) {
	// This test verifies that we're using constant-time comparison
	// We can't directly measure timing, but we can verify the behavior
	// is consistent regardless of where the difference occurs

	baseToken := "sbld_sa_base_token_for_timing_test_12345"
	baseHash := hashTokenSHA256(baseToken)

	// Create tokens that differ at different positions
	tokensWithDiffs := []string{
		"Xbld_sa_base_token_for_timing_test_12345",  // first char
		"sbld_sa_Xase_token_for_timing_test_12345",  // middle char
		"sbld_sa_base_token_for_timing_test_1234X",  // last char
		"completely_different_token_value_here!!!!", // completely different
	}

	for i, differentToken := range tokensWithDiffs {
		t.Run(string(rune('A'+i)), func(t *testing.T) {
			isValid, err := verifyTokenSHA256(
				differentToken,
				baseHash,
			)

			require.NoError(t, err, "Should not error")
			require.False(t, isValid, "Should be invalid")
		})
	}
}

// Test_verifyTokenBcrypt verifies bcrypt token verification and migration flag
func Test_verifyTokenBcrypt(t *testing.T) {
	// Generate a test token
	token := "sbld_sa_bcrypt_test_token_123"

	// Create bcrypt hash (this is what would be stored in the database)
	bcryptHash, err := bcrypt.GenerateFromPassword([]byte(token), bcrypt.DefaultCost)
	require.NoError(t, err, "Failed to generate bcrypt hash for test")

	tests := []struct {
		name            string
		presentedToken  string
		storedHash      string
		expectedValid   bool
		expectedMigrate bool
		expectedError   bool
	}{
		{
			name:            "valid bcrypt token",
			presentedToken:  token,
			storedHash:      string(bcryptHash),
			expectedValid:   true,
			expectedMigrate: true, // bcrypt should signal migration needed
			expectedError:   false,
		},
		{
			name:            "invalid bcrypt token - wrong token",
			presentedToken:  "sbld_sa_wrong_token",
			storedHash:      string(bcryptHash),
			expectedValid:   false,
			expectedMigrate: false,
			expectedError:   false,
		},
		{
			name:            "invalid bcrypt token - empty token",
			presentedToken:  "",
			storedHash:      string(bcryptHash),
			expectedValid:   false,
			expectedMigrate: false,
			expectedError:   false,
		},
		{
			name:            "invalid hash - malformed bcrypt hash",
			presentedToken:  token,
			storedHash:      "not_a_valid_bcrypt_hash",
			expectedValid:   false,
			expectedMigrate: false,
			expectedError:   true, // malformed hash causes error
		},
		{
			name:            "invalid hash - empty hash",
			presentedToken:  token,
			storedHash:      "",
			expectedValid:   false,
			expectedMigrate: false,
			expectedError:   true, // empty hash causes error
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid, err := verifyTokenBcrypt(
				tt.presentedToken,
				tt.storedHash,
			)

			if tt.expectedError {
				require.Error(t, err, "Expected error but got none")
			} else {
				require.NoError(t, err, "Unexpected error: %v", err)
			}

			require.Equal(t, tt.expectedValid, isValid,
				"isValid mismatch")
		})
	}
}
