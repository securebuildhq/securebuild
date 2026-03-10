"use server"

import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { refreshActiveSubscriptions } from "../subscription";
import { traceServerAction } from "@/lib/observability/tracing";

async function refreshTeamSubscriptionsActionImpl(sess: Session): Promise<void> {
  const validatedSession = await requireValidSession(sess);
  await refreshActiveSubscriptions(validatedSession.selectedTeamId);
}

export const refreshTeamSubscriptionsAction = traceServerAction('refreshTeamSubscriptionsAction', refreshTeamSubscriptionsActionImpl);
