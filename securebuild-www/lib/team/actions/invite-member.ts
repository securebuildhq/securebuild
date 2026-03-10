"use server"

import { Invite } from "@/lib/types/invite";
import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { inviteTeamMember } from "../team";
import { traceServerAction } from "@/lib/observability/tracing";

async function inviteTeamMemberActionImpl(sess: Session, email: string, role: "admin" | "developer" | "viewer"): Promise<Invite> {
  const validatedSession = await requireValidSession(sess);
  const invite = await inviteTeamMember(validatedSession.selectedTeamId, email, role);
  return invite;
}

export const inviteTeamMemberAction = traceServerAction('inviteTeamMemberAction', inviteTeamMemberActionImpl);
