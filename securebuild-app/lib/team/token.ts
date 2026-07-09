import crypto from "crypto";

const SERVICE_ACCOUNT_TOKEN_PREFIX = "sbld_sa_";
const TOKEN_RANDOM_BYTES = 32;

export const ALGORITHM_SHA256 = "sha256";

export function generateServiceAccountToken(): {
  token: string;
  hash: string;
  partialValue: string;
} {
  const randomBytes = crypto.randomBytes(TOKEN_RANDOM_BYTES);
  const randomString = randomBytes.toString('base64url');
  const token = SERVICE_ACCOUNT_TOKEN_PREFIX + randomString;
  const hash = hashTokenSHA256(token);
  const partialValue = serviceAccountGetPartialValue(token);

  return { token, hash, partialValue };
}

export function hashTokenSHA256(token: string): string {
  const hasher = crypto.createHash("sha256");
  hasher.update(token);
  const hashBytes = hasher.digest();
  return hashBytes.toString("base64");
}

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
