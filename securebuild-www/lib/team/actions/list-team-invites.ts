"use server"

import { Invite } from "@/lib/types/invite";
import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { listTeamInvites } from "../team";
import { traceServerAction } from "@/lib/observability/tracing";

async function listTeamInvitesActionImpl(sess: Session): Promise<Invite[]> {
  const validatedSession = await requireValidSession(sess);
  const invites = await listTeamInvites(validatedSession.selectedTeamId);
  return invites;
}

export const listTeamInvitesAction = traceServerAction('listTeamInvitesAction', listTeamInvitesActionImpl);
