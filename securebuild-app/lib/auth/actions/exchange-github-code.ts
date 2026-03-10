"use server";

import { logger } from "@/lib/utils/logger";
import { upsertUserIfInvited } from "../user";
import { createSession, sessionToken } from "@/lib/auth/session";

async function fetchGithubProfile(code: string) {
  // First, exchange code for access token
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = await tokenResponse.json();

if (!tokenData.access_token) {
    throw new Error('Failed to get access token');
  }

  // Then, use access token to get user profile
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Accept': 'application/json',
    },
  });

  const userData = await userResponse.json();

  if (!userData.id) {
    throw new Error('Failed to get user profile');
  }

  return {
    id: userData.id,
    email: userData.email,
    name: userData.name || userData.login,
    picture: userData.avatar_url,
    login: userData.login,
  };
}

export async function exchangeGithubCodeForSession(code: string): Promise<string> {
  try {
    const profile = await fetchGithubProfile(code);
    
    // Check if the user has a public email before attempting to create user
    if (!profile.email) {
      const error = new Error('GitHub account must have a public email address. Please set a public email in your GitHub profile settings.');
      logger.error("GitHub authentication failed - no public email", { login: profile.login, error });
      throw error;
    }
    
    const user = await upsertUserIfInvited(profile.email, profile.name, profile.picture, profile.login);
    const sess = await createSession(user);
    const jwt = await sessionToken(sess);
    return jwt;
  } catch (error) {
    logger.error("Failed to exchange GitHub code for session", { error });
    throw error;
  }
}
