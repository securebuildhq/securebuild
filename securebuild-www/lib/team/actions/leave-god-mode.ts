"use server";

import { Session } from "@/lib/types/session";
import { removeGodModeTeamFromSession, sessionToken } from "@/lib/user/session";
import { traceServerAction } from "@/lib/observability/tracing";

async function leaveGodModeActionImpl(session: Session, teamId: string): Promise<string> {
  const newSession = await removeGodModeTeamFromSession(session.id, teamId);
  const newToken = await sessionToken(newSession);
  return newToken;
}

export const leaveGodModeAction = traceServerAction('leaveGodModeAction', leaveGodModeActionImpl);
