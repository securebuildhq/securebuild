"use server"

import { findSession, removeGodModeTeamFromSession, sessionToken } from "@/lib/user/session";
import { Session } from "@/lib/types/session";
import { traceServerAction } from "@/lib/observability/tracing";

async function leaveGodModeActionImpl(sess: Session, teamId: string): Promise<string> {
  const currentSession = await findSession(undefined, sess.id);
  if (!currentSession) {
    throw new Error("Session not found");
  }

  if (currentSession.expiresAt < new Date()) {
    throw new Error("Session expired");
  }

  const updatedSession = await removeGodModeTeamFromSession(sess.id, teamId);
  return sessionToken(updatedSession);
}

export const leaveGodModeAction = traceServerAction('leaveGodModeAction', leaveGodModeActionImpl);