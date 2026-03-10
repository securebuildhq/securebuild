"use server"

import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { listTeamInvites } from "../team";
import { enqueueWork } from "@/lib/utils/queue";
import { traceServerAction } from "@/lib/observability/tracing";

async function resendInviteActionImpl(sess: Session, id: string): Promise<void> {
  const validatedSession = await requireValidSession(sess);

  const invites = await listTeamInvites(validatedSession.selectedTeamId);
  const invite = invites.find((invite) => invite.id === id);
  if (!invite) {
    throw new Error("Invite not found");
  }

  await enqueueWork('send_email', {
    'event': 'invite_team_member',
    'data': {
      'invite_id': id,
      'team_id': validatedSession.selectedTeamId,
      'email': invite.email,
      'role': invite.role,
    }
  })
}

export const resendInviteAction = traceServerAction('resendInviteAction', resendInviteActionImpl);
