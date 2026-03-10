"use server"

import { Session } from "@/lib/types/session";
import { Subscription } from "@/lib/types/subscription";
import { requireValidSession } from "@/lib/utils/session-validation";
import { listTeamSubscriptions } from "../subscription";
import { traceServerAction } from "@/lib/observability/tracing";

async function listTeamSubscriptionsActionImpl(sess: Session): Promise<Subscription[]> {
  const validatedSession = await requireValidSession(sess);
  const subscriptions = await listTeamSubscriptions(validatedSession.selectedTeamId);
  return subscriptions;
}

export const listTeamSubscriptionsAction = traceServerAction('listTeamSubscriptionsAction', listTeamSubscriptionsActionImpl);
