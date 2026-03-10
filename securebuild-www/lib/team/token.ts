import crypto from "crypto";
import bcrypt from "bcrypt";

// serviceAccountTokenPrefix is prepended to all service account tokens for leak detection
const SERVICE_ACCOUNT_TOKEN_PREFIX = "sbld_sa_";

// tokenRandomBytes is the number of cryptographically secure random bytes generated
const TOKEN_RANDOM_BYTES = 32; // 256 bits

// algorithmSHA256 identifies SHA-256 hashed tokens
export const ALGORITHM_SHA256 = "sha256";

// algorithmBcrypt identifies bcrypt hashed tokens (legacy)
export const ALGORITHM_BCRYPT = "bcrypt";

/**
 * GenerateServiceAccountToken generates a new service account token with cryptographically
 * secure random data and returns the token, its SHA-256 hash, and a partial value for display.
 *
 * The token format is: "sbld_sa_" + base64url(32 random bytes)
 * The hash is: base64(SHA-256(token))
 * The partial value is extracted from the random portion after the prefix
 *
 * Returns:
 *   - token: The full token string to be provided to the user (store securely)
 *   - hash: The SHA-256 hash to be stored in the database
 *   - partialValue: Characters for display purposes (from the random portion)
 */
export function generateServiceAccountToken(): {
  token: string;
  hash: string;
  partialValue: string;
} {
  // Generate 32 bytes (256 bits) of cryptographically secure random data
  const randomBytes = crypto.randomBytes(TOKEN_RANDOM_BYTES);
  
  // Encode as base64url for URL-safe tokens
  const randomString = randomBytes.toString('base64url');

  // Add prefix for leak detection
  const token = SERVICE_ACCOUNT_TOKEN_PREFIX + randomString;

  // Hash the full token with SHA-256
  const hash = hashTokenSHA256(token);

  // Partial value is extracted from the random portion (first 4 chars after prefix)
  const partialValue = serviceAccountGetPartialValue(token);

  return { token, hash, partialValue };
}

/**
 * hashTokenSHA256 computes the SHA-256 hash of a token and returns it as base64-encoded string.
 *
 * This function is used both for generating hashes during token creation and for verifying
 * presented tokens against stored hashes.
 *
 * Parameters:
 *   - token: The full token string to hash
 *
 * Returns:
 *   - The base64-encoded SHA-256 hash of the token
 */
export function hashTokenSHA256(token: string): string {
  const hasher = crypto.createHash("sha256");
  hasher.update(token);
  const hashBytes = hasher.digest();
  return hashBytes.toString("base64");
}

/**
 * verifyTokenSHA256 verifies a presented token against a stored hash using the SHA-256 algorithm.
 *
 * Parameters:
 *   - presentedToken: The token provided by the user/service
 *   - storedHash: The hash stored in the database
 *
 * Returns:
 *   - isValid: true if the token matches the stored hash
 */
export function verifyTokenSHA256(
  presentedToken: string,
  storedHash: string
): boolean {
  // Compute SHA-256 hash of presented token
  const presentedHash = hashTokenSHA256(presentedToken);

  // Use constant-time comparison to prevent timing attacks
  // crypto.timingSafeEqual requires buffers of the same length
  try {
    const presentedBuffer = Buffer.from(presentedHash);
    const storedBuffer = Buffer.from(storedHash);

    if (presentedBuffer.length !== storedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(presentedBuffer, storedBuffer);
  } catch {
    return false;
  }
}

/**
 * verifyTokenBcrypt verifies a presented token against a stored hash using the bcrypt algorithm.
 *
 * Parameters:
 *   - presentedToken: The token provided by the user/service
 *   - storedHash: The hash stored in the database
 *
 * Returns:
 *   - isValid: true if the token matches the stored hash
 */
export async function verifyTokenBcrypt(
  presentedToken: string,
  storedHash: string
): Promise<boolean> {
  try {
    // Use bcrypt's built-in comparison
    return await bcrypt.compare(presentedToken, storedHash);
  } catch {
    // Token is invalid or other bcrypt error
    return false;
  }
}

/**
 * serviceAccountGetPartialValue extracts characters from a token for filtering.
 *
 * If the token has the prefix "sbld_sa_", it extracts len(prefix) + 4 characters.
 * Otherwise, it extracts the first 4 characters.
 *
 * Parameters:
 *   - token: The token to extract from
 *
 * Returns:
 *   - The partial value for database filtering
 */
export function serviceAccountGetPartialValue(token: string): string {
  if (token.startsWith(SERVICE_ACCOUNT_TOKEN_PREFIX)) {
    if (token.length >= SERVICE_ACCOUNT_TOKEN_PREFIX.length + 4) {
      return token.substring(0, SERVICE_ACCOUNT_TOKEN_PREFIX.length + 4);
    }
    return token;
  }

  if (token.length >= 4) {
    return token.substring(0, 4);
  }

  return token;
}
