"use server"

import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { addUserToTeam, deleteTeamInvite, getInviteByToken, getTeam } from "../team";
import { getUser } from "@/lib/user/user";
import { sessionToken } from "@/lib/user/session";
import { traceServerAction } from "@/lib/observability/tracing";

async function acceptInviteActionImpl(sess: Session, token: string): Promise<string> {
  const validatedSession = await requireValidSession(sess);

  const invite = await getInviteByToken(token);
  const team = await getTeam(invite.teamId);
  const user = await getUser(validatedSession.user.id);

  if (!user) {
    throw new Error("User not found");
  }
  await addUserToTeam(user.id, team.id);

  await deleteTeamInvite(invite.id);

  // update the session with the new team
  validatedSession.teams = [...validatedSession.teams, team];

  return sessionToken(validatedSession);
}

export const acceptInviteAction = traceServerAction('acceptInviteAction', acceptInviteActionImpl);
