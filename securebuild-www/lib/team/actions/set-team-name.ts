"use server"

import { Session } from "@/lib/types/session";
import { Team } from "@/lib/types/team";
import { requireValidSession } from "@/lib/utils/session-validation";
import { setTeamName } from "../team";
import { traceServerAction } from "@/lib/observability/tracing";

async function setTeamNameActionImpl(sess: Session, name: string): Promise<Team> {
  const validatedSession = await requireValidSession(sess);
  const team = await setTeamName(validatedSession.selectedTeamId, name);
  return team;
}

export const setTeamNameAction = traceServerAction('setTeamNameAction', setTeamNameActionImpl);
