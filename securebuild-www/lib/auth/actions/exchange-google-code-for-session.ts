"use server"

import { addUserToTeam, createUserDefaultTeam, getInviteById } from "@/lib/team/team";
import { createSession, sessionToken } from "@/lib/user/session";
import { upsertUser } from "@/lib/user/user";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function fetchGoogleProfile(code: string) {
  if (!process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_SECRET is not set");
  }

  if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
    throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set");
  }

  if (!process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI) {
    throw new Error("NEXT_PUBLIC_GOOGLE_REDIRECT_URI is not set");
  }

  const params = new URLSearchParams({
    code,
    client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI,
    grant_type: "authorization_code",
  });

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      logger.error("Failed to fetch Google token", { status: tokenResponse.status, errorBody });
      throw new Error(`Failed to fetch Google token: ${tokenResponse.status} ${errorBody}`);
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;

    if (!accessToken) {
      logger.error("No access token found in Google response", { tokens });
      throw new Error("No access token found in Google response");
    }

    const profileResponse = await fetch(
      "https://www.googleapis.com/oauth2/v1/userinfo",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!profileResponse.ok) {
      const errorBody = await profileResponse.text();
      logger.error("Failed to fetch Google user profile", { status: profileResponse.status, errorBody });
      throw new Error(
        `Failed to fetch Google user profile: ${profileResponse.status} ${errorBody}`
      );
    }

    const profile = await profileResponse.json();
    return profile;
  } catch (error) {
    logger.error("Error in fetchGoogleProfile", { error });
    throw error;
  }
}

export interface LoginResult {
  jwt: string;
  error: string;
}

async function exchangeGoogleCodeForSessionActionImpl(code: string, inviteId: string|undefined): Promise<LoginResult> {
  try {
    const profile = await fetchGoogleProfile(code);

    let teamId: string|undefined;
    if (inviteId) {
      const invite = await getInviteById(inviteId);

      // if there's an invite and the email address doesn't match what we just logged in as, throw an error
      if (invite) {
        if (invite.email !== profile.email) {
          return {
            jwt: "",
            error: "Invite email address does not match the email address we just logged in as",
          };
        }

        teamId = invite.teamId;
      }
    }
    const user = await upsertUser(profile.email, profile.given_name, profile.family_name, profile.picture, profile.hd);

    if (teamId) {
      await addUserToTeam(user.id, teamId);
    } else {
      await createUserDefaultTeam(user.id);
    }

    const sess = await createSession(user);
    const jwt = await sessionToken(sess);

    return {
      jwt,
      error: "",
    }
  } catch (error) {
    logger.error("Failed to exchange Google code for session", { error });
    throw error;
  }
}

export const exchangeGoogleCodeForSessionAction = traceServerAction('exchangeGoogleCodeForSessionAction', exchangeGoogleCodeForSessionActionImpl);