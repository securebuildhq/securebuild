"use server"

import { Session } from "@/lib/types/session"
import { Team } from "@/lib/types/team"
import { requireValidSession } from "@/lib/utils/session-validation"
import { traceServerAction } from "@/lib/observability/tracing"
import { getTeam } from "../team"

async function getTeamActionImpl(sess: Session): Promise<Team> {
    const validatedSession = await requireValidSession(sess)
    const team = await getTeam(validatedSession.selectedTeamId)
    return team
}

export const getTeamAction = traceServerAction('getTeamAction', getTeamActionImpl);
