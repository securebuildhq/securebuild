"use server"

import { Session } from "@/lib/types/session";
import { findSession, sessionToken, setSelectedTeamInSession } from "@/lib/user/session";
import { traceServerAction } from "@/lib/observability/tracing";
import { listUserTeams } from "../team";

async function setSelectedTeamActionImpl(sess: Session, teamId: string): Promise<string> {
  const currentSession = await findSession(undefined, sess.id);
  if (!currentSession) {
    throw new Error("Session not found");
  }

  if (currentSession.expiresAt < new Date()) {
    throw new Error("Session expired");
  }

  const userTeams = await listUserTeams(currentSession.user.id);
  const godModeTeams = currentSession.godModeTeams;
  if (!userTeams.some((team) => team.id === teamId) && !godModeTeams.some((team) => team.id === teamId)) {
    throw new Error("User is not a member of the team");
  }

  // make sure the user is selecting a team they are a member of
  const team = userTeams.find((team) => team.id === teamId) || godModeTeams.find((team) => team.id === teamId);
  if (!team) {
    throw new Error("Team not found");
  }

  // update the session with the new selected team
  const newSession = await setSelectedTeamInSession(sess.id, teamId);

  return sessionToken(newSession);
}

export const setSelectedTeamAction = traceServerAction('setSelectedTeamAction', setSelectedTeamActionImpl);