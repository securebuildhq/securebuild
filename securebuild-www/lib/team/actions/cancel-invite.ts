"use server"

import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { deleteTeamInvite } from "../team";
import { traceServerAction } from "@/lib/observability/tracing";

async function cancelInviteActionImpl(sess: Session, id: string): Promise<void> {
  await requireValidSession(sess);
  await deleteTeamInvite(id);
}

export const cancelInviteAction = traceServerAction('cancelInviteAction', cancelInviteActionImpl);
