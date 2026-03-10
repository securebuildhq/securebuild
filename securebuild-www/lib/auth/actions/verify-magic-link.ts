"use server";

import { logger } from "@/lib/utils/logger";
import { createSession, sessionToken } from "@/lib/user/session";
import { verifyMagicLink } from "@/lib/user/magic-link";
import { upsertUser } from "@/lib/user/user";
import { addUserToTeam, createUserDefaultTeam, deleteTeamInvite, getInviteById } from "@/lib/team/team";
import { traceServerAction } from "@/lib/observability/tracing";

interface VerifyMagicLinkResult {
  success: boolean;
  jwt?: string;
  error?: string;
}

async function verifyMagicLinkActionImpl(email: string, code: string, inviteId: string|undefined): Promise<VerifyMagicLinkResult> {
  try {
    const passwordlessLoginNonceID = await verifyMagicLink(email, code);
    if (!passwordlessLoginNonceID) {
      return { success: false, error: "Invalid code" };
    }

    let teamId: string|undefined;

    if (inviteId) {
      const invite = await getInviteById(inviteId);
      if (invite) {
        if (invite.email !== email) {
          return { success: false, error: "Invite email address does not match the email address we just logged in as" };
        }

        teamId = invite.teamId;
      }
    }

    // upsert the user
    const user = await upsertUser(email, "", "", "", "");

    if (teamId) {
      await addUserToTeam(user.id, teamId);
    } else {
      await createUserDefaultTeam(user.id);
    }

    if (inviteId) {
      await deleteTeamInvite(inviteId);
    }

    const sess = await createSession(user);
    const jwt = await sessionToken(sess);

    return {
      success: true,
      jwt,
    };
  } catch (error) {
    logger.error("Failed to verify magic link", { error });
    return { success: false, error: "Verification failed" };
  }
}

export const verifyMagicLinkAction = traceServerAction('verifyMagicLinkAction', verifyMagicLinkActionImpl);