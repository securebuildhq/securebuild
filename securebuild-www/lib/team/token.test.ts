import crypto from "crypto";
import bcrypt from "bcrypt";
import {
  generateServiceAccountToken,
  hashTokenSHA256,
  verifyTokenSHA256,
  verifyTokenBcrypt,
  serviceAccountGetPartialValue,
  ALGORITHM_SHA256,
  ALGORITHM_BCRYPT,
} from "./token";

describe("Service Account Token Functions", () => {
  describe("generateServiceAccountToken", () => {
    it("should generate a token with correct structure", () => {
      const result = generateServiceAccountToken();

      expect(result).toHaveProperty("token");
      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("partialValue");
      expect(typeof result.token).toBe("string");
      expect(typeof result.hash).toBe("string");
      expect(typeof result.partialValue).toBe("string");
    });

    it("should generate token with correct prefix", () => {
      const result = generateServiceAccountToken();

      expect(result.token).toMatch(/^sbld_sa_/);
    });

    it("should generate token with sufficient random data", () => {
      const result = generateServiceAccountToken();

      // Token should be prefix (8 chars) + 32 random chars = at least 40 chars
      expect(result.token.length).toBeGreaterThanOrEqual(40);
    });

    it("should generate unique tokens on each call", () => {
      const result1 = generateServiceAccountToken();
      const result2 = generateServiceAccountToken();
      const result3 = generateServiceAccountToken();

      expect(result1.token).not.toBe(result2.token);
      expect(result1.token).not.toBe(result3.token);
      expect(result2.token).not.toBe(result3.token);
      expect(result1.hash).not.toBe(result2.hash);
    });

    it("should generate valid base64 hash", () => {
      const result = generateServiceAccountToken();

      // Base64 regex pattern
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      expect(result.hash).toMatch(base64Regex);
    });

    it("should extract partial value from token", () => {
      const result = generateServiceAccountToken();

      // Partial value should be 4 characters from after the prefix
      expect(result.partialValue.length).toBe(12);

      // Verify the partial value matches what's in the token
      expect(result.partialValue).toBe(result.token.substring(0, 12));
    });

    it("should generate hash that can verify the token", () => {
      const result = generateServiceAccountToken();

      // The generated hash should verify the generated token
      const isValid = verifyTokenSHA256(result.token, result.hash);
      expect(isValid).toBe(true);
    });
  });

  describe("hashTokenSHA256", () => {
    it("should return consistent hash for same input", () => {
      const token = "sbld_sa_test123456789";
      const hash1 = hashTokenSHA256(token);
      const hash2 = hashTokenSHA256(token);

      expect(hash1).toBe(hash2);
    });

    it("should return different hashes for different inputs", () => {
      const token1 = "sbld_sa_test123456789";
      const token2 = "sbld_sa_test987654321";
      const hash1 = hashTokenSHA256(token1);
      const hash2 = hashTokenSHA256(token2);

      expect(hash1).not.toBe(hash2);
    });

    it("should return base64 encoded string", () => {
      const token = "sbld_sa_test123456789";
      const hash = hashTokenSHA256(token);

      // Base64 regex pattern
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      expect(hash).toMatch(base64Regex);
    });

    it("should produce SHA-256 hash of correct length", () => {
      const token = "sbld_sa_test123456789";
      const hash = hashTokenSHA256(token);

      // SHA-256 produces 32 bytes, which in base64 is 44 characters (with padding)
      const decodedHash = Buffer.from(hash, "base64");
      expect(decodedHash.length).toBe(32);
    });

    it("should handle empty string input", () => {
      const hash = hashTokenSHA256("");

      expect(hash).toBeTruthy();
      expect(typeof hash).toBe("string");

      // Empty string hash should be consistent
      const hash2 = hashTokenSHA256("");
      expect(hash).toBe(hash2);
    });

    it("should handle special characters in token", () => {
      const token = "sbld_sa_!@#$%^&*()";
      const hash = hashTokenSHA256(token);

      expect(hash).toBeTruthy();
      expect(typeof hash).toBe("string");
    });
  });

  describe("verifyTokenSHA256", () => {
    it("should return true for matching token and hash", () => {
      const token = "sbld_sa_test123456789";
      const hash = hashTokenSHA256(token);

      const result = verifyTokenSHA256(token, hash);

      expect(result).toBe(true);
    });

    it("should return false for non-matching token and hash", () => {
      const token1 = "sbld_sa_test123456789";
      const token2 = "sbld_sa_test987654321";
      const hash1 = hashTokenSHA256(token1);

      const result = verifyTokenSHA256(token2, hash1);

      expect(result).toBe(false);
    });

    it("should return false for completely different hash", () => {
      const token = "sbld_sa_test123456789";
      const wrongHash = "aW52YWxpZGhhc2g="; // "invalidhash" in base64

      const result = verifyTokenSHA256(token, wrongHash);

      expect(result).toBe(false);
    });

    it("should return false for invalid base64 hash", () => {
      const token = "sbld_sa_test123456789";
      const invalidHash = "not-valid-base64!!!";

      const result = verifyTokenSHA256(token, invalidHash);

      expect(result).toBe(false);
    });

    it("should return false when hash lengths differ", () => {
      const token = "sbld_sa_test123456789";
      const shortHash = "YWJj"; // "abc" in base64 (3 bytes)

      const result = verifyTokenSHA256(token, shortHash);

      expect(result).toBe(false);
    });

    it("should handle empty token", () => {
      const token = "";
      const hash = hashTokenSHA256(token);

      const result = verifyTokenSHA256(token, hash);

      expect(result).toBe(true);
    });

    it("should use timing-safe comparison", () => {
      // This test ensures the function calls timingSafeEqual
      const token = "sbld_sa_test123456789";
      const hash = hashTokenSHA256(token);

      // Spy on crypto.timingSafeEqual
      const timingSafeEqualSpy = jest.spyOn(crypto, "timingSafeEqual");

      verifyTokenSHA256(token, hash);

      expect(timingSafeEqualSpy).toHaveBeenCalled();

      timingSafeEqualSpy.mockRestore();
    });

    it("should be case sensitive", () => {
      const token = "sbld_sa_test123456789";
      const hash = hashTokenSHA256(token);
      const tokenUpperCase = "SBLD_SA_TEST123456789";

      const result = verifyTokenSHA256(tokenUpperCase, hash);

      expect(result).toBe(false);
    });
  });

  describe("verifyTokenBcrypt", () => {
    it("should return true for matching token and bcrypt hash", async () => {
      const token = "sbld_sa_test123456789";
      const hash = await bcrypt.hash(token, 10);

      const result = await verifyTokenBcrypt(token, hash);

      expect(result).toBe(true);
    });

    it("should return false for non-matching token and hash", async () => {
      const token1 = "sbld_sa_test123456789";
      const token2 = "sbld_sa_test987654321";
      const hash = await bcrypt.hash(token1, 10);

      const result = await verifyTokenBcrypt(token2, hash);

      expect(result).toBe(false);
    });

    it("should return false for invalid bcrypt hash", async () => {
      const token = "sbld_sa_test123456789";
      const invalidHash = "not-a-valid-bcrypt-hash";

      const result = await verifyTokenBcrypt(token, invalidHash);

      expect(result).toBe(false);
    });

    it("should handle empty token with bcrypt hash", async () => {
      const token = "";
      const hash = await bcrypt.hash(token, 10);

      const result = await verifyTokenBcrypt(token, hash);

      expect(result).toBe(true);
    });

    it("should be case sensitive", async () => {
      const token = "sbld_sa_test123456789";
      const hash = await bcrypt.hash(token, 10);
      const tokenUpperCase = "SBLD_SA_TEST123456789";

      const result = await verifyTokenBcrypt(tokenUpperCase, hash);

      expect(result).toBe(false);
    });

    it("should handle bcrypt errors gracefully", async () => {
      const token = "sbld_sa_test123456789";
      const malformedHash = "$2b$10$invalid";

      const result = await verifyTokenBcrypt(token, malformedHash);

      expect(result).toBe(false);
    });
  });

  describe("serviceAccountGetPartialValue", () => {
    it("should extract 4 characters from token with prefix", () => {
      const token = "sbld_sa_abcd1234567890";
      const partial = serviceAccountGetPartialValue(token);

      expect(partial).toBe("sbld_sa_abcd");
    });

    it("should extract from position after prefix", () => {
      const token = "sbld_sa_xyz9876543210";
      const partial = serviceAccountGetPartialValue(token);

      expect(partial).toBe("sbld_sa_xyz9");
    });

    it("should extract first 4 chars from token without prefix", () => {
      const token = "randomtoken1234567890";
      const partial = serviceAccountGetPartialValue(token);

      expect(partial).toBe("rand");
    });

    it("should return full token if after-prefix is less than 4 chars", () => {
      const token = "sbld_sa_abc";
      const partial = serviceAccountGetPartialValue(token);

      expect(partial).toBe(token);
    });

    it("should return full token if token without prefix is less than 4 chars", () => {
      const token = "abc";
      const partial = serviceAccountGetPartialValue(token);

      expect(partial).toBe("abc");
    });

    it("should handle empty string", () => {
      const token = "";
      const partial = serviceAccountGetPartialValue(token);

      expect(partial).toBe("");
    });

    it("should handle token that is exactly the prefix", () => {
      const token = "sbld_sa_";
      const partial = serviceAccountGetPartialValue(token);

      expect(partial).toBe(token);
    });

    it("should handle token with exactly 4 chars after prefix", () => {
      const token = "sbld_sa_abcd";
      const partial = serviceAccountGetPartialValue(token);

      expect(partial).toBe("sbld_sa_abcd");
    });

    it("should handle token with more than 4 chars after prefix", () => {
      const token = "sbld_sa_abcdefghijklmnop";
      const partial = serviceAccountGetPartialValue(token);

      expect(partial).toBe("sbld_sa_abcd");
    });

    it("should handle unicode characters", () => {
      const token = "sbld_sa_😀🎉🎊🎈more";
      const partial = serviceAccountGetPartialValue(token);

      // JavaScript's substring counts UTF-16 code units, not characters
      // Emojis are 2 code units each, so 4 code units = 2 emojis
      expect(partial.length).toBe(12);
      expect(partial).toBe("sbld_sa_😀🎉");
    });

    it("should handle prefix-like patterns in middle of token", () => {
      const token = "testsbld_sa_1234567890";
      const partial = serviceAccountGetPartialValue(token);

      // Should extract from beginning, not from the prefix pattern
      expect(partial).toBe("test");
    });
  });

  describe("Algorithm Constants", () => {
    it("should export ALGORITHM_SHA256 constant", () => {
      expect(ALGORITHM_SHA256).toBe("sha256");
    });

    it("should export ALGORITHM_BCRYPT constant", () => {
      expect(ALGORITHM_BCRYPT).toBe("bcrypt");
    });
  });

  describe("Integration Tests", () => {
    it("should support full token lifecycle with SHA256", () => {
      // Generate token
      const { token, hash, partialValue } = generateServiceAccountToken();

      // Verify token
      const isValid = verifyTokenSHA256(token, hash);
      expect(isValid).toBe(true);

      // Verify partial value extraction
      const extractedPartial = serviceAccountGetPartialValue(token);
      expect(extractedPartial).toBe(partialValue);
    });

    it("should not verify token with wrong hash", () => {
      const { token } = generateServiceAccountToken();
      const { hash: wrongHash } = generateServiceAccountToken();

      const isValid = verifyTokenSHA256(token, wrongHash);
      expect(isValid).toBe(false);
    });

    it("should handle multiple token generations and verifications", () => {
      const tokens = Array.from({ length: 10 }, () =>
        generateServiceAccountToken()
      );

      // All tokens should be unique
      const uniqueTokens = new Set(tokens.map((t) => t.token));
      expect(uniqueTokens.size).toBe(10);

      // All tokens should verify with their own hashes
      tokens.forEach(({ token, hash }) => {
        expect(verifyTokenSHA256(token, hash)).toBe(true);
      });

      // No token should verify with another token's hash
      tokens.forEach(({ token }, i) => {
        tokens.forEach(({ hash }, j) => {
          if (i !== j) {
            expect(verifyTokenSHA256(token, hash)).toBe(false);
          }
        });
      });
    });
  });
});
