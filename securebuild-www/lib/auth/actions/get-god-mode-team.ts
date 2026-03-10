"use server"

import { Session } from "@/lib/types/session";
import { Team } from "@/lib/types/team";
import { getGodModeTeam } from "../god";
import { traceServerAction } from "@/lib/observability/tracing";

async function getGodModeTeamActionImpl(sess: Session, nonce: string): Promise<Team> {
  const team = await getGodModeTeam(nonce);
  return team;
}

export const getGodModeTeamAction = traceServerAction('getGodModeTeamAction', getGodModeTeamActionImpl);
