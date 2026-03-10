"use server"

import { Invite } from "@/lib/types/invite";
import { Session } from "@/lib/types/session";
import { optionalValidSession } from "@/lib/utils/session-validation";
import { getInviteByToken, getTeamNameForInvite } from "../team";
import { traceServerAction } from "@/lib/observability/tracing";

export interface GetInviteByTokenActionResult {
  invite: Invite;
  teamName: string;
}

async function getInviteByTokenActionImpl(sess: Session | undefined, token: string): Promise<GetInviteByTokenActionResult> {
  await optionalValidSession(sess);

  const invite = await getInviteByToken(token);
  const teamName = await getTeamNameForInvite(invite.id);

  return {
    invite,
    teamName,
  };
}

export const getInviteByTokenAction = traceServerAction('getInviteByTokenAction', getInviteByTokenActionImpl);
