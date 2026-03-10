"use server";

import { logger } from "@/lib/utils/logger";
import { upsertUserIfInvited } from "../user";
import { createSession, sessionToken } from "@/lib/auth/session";

/**
 * Test-mode authentication bypass for E2E tests
 *
 * SECURITY: This function only works when E2E_TEST_MODE=true
 * NEVER enable E2E_TEST_MODE in production environments
 *
 * This allows E2E tests to authenticate without GitHub OAuth,
 * creating a test session for a hardcoded test user.
 */
export async function testModeLogin(): Promise<string> {
  // CRITICAL: Only allow in test mode
  if (process.env.E2E_TEST_MODE !== 'true') {
    const error = new Error('Test-mode login is disabled. Set E2E_TEST_MODE=true to enable.');
    logger.error("Attempt to use test-mode login with E2E_TEST_MODE disabled", { error });
    throw error;
  }

  try {
    // Test user profile (matches integration test patterns)
    const testProfile = {
      email: 'test@securebuild.io',
      name: 'E2E Test User',
      picture: 'https://avatars.githubusercontent.com/u/0?v=4',
      login: 'e2e-test-user',
    };

    logger.info("E2E test-mode login", { email: testProfile.email });

    const user = await upsertUserIfInvited(
      testProfile.email,
      testProfile.name,
      testProfile.picture,
      testProfile.login
    );

    const sess = await createSession(user);
    const jwt = await sessionToken(sess);

    return jwt;
  } catch (error) {
    logger.error("Failed to create test-mode session", { error });
    throw error;
  }
}

/**
 * Check if test mode is enabled
 */
export async function isTestModeEnabled(): Promise<boolean> {
  return process.env.E2E_TEST_MODE === 'true';
}
