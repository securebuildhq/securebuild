"use server"

import { requireValidSession } from "@/lib/utils/session-validation"
import { Session } from "@/lib/types/session"
import { removeUserFromTeam } from "../team";
import { traceServerAction } from "@/lib/observability/tracing";

async function removeMemberActionImpl(sess: Session, memberId: string) {
  const validatedSession = await requireValidSession(sess)

  // the user cannot remove themselves from the team
  if (memberId === validatedSession.user.id) {
    throw new Error("You cannot remove yourself from the team");
  }

  await removeUserFromTeam(memberId, validatedSession.selectedTeamId);
}

export const removeMemberAction = traceServerAction('removeMemberAction', removeMemberActionImpl);