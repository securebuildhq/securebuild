"use server"

import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { refreshActiveSubscriptions } from "@/lib/team/subscription";
import { traceServerAction } from "@/lib/observability/tracing";

async function refreshSubscriptionActionImpl(sess: Session): Promise<void> {
  const validatedSession = await requireValidSession(sess);
  await refreshActiveSubscriptions(validatedSession.selectedTeamId);
}

export const refreshSubscriptionAction = traceServerAction('refreshSubscriptionAction', refreshSubscriptionActionImpl);
