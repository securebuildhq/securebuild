"use server"

import { Session } from "@/lib/types/session"
import { logger } from "@/lib/utils/logger"
import { listTeamSubscriptions, refreshActiveSubscriptions } from "../subscription";
import { cancelSubscription } from "../subscription";
import { requireValidSession } from "@/lib/utils/session-validation";
import { traceServerAction } from "@/lib/observability/tracing";

async function cancelSubscriptionActionImpl(sess: Session, subscriptionId: string) {
  const validatedSession = await requireValidSession(sess);
  logger.info("cancelling subscription", { subscriptionId, teamId: validatedSession.selectedTeamId });

  const localSubscriptions = await listTeamSubscriptions(validatedSession.selectedTeamId);

  // make sure the subscription is in the list
  const localSubscription = localSubscriptions.find(s => s.id === subscriptionId);
  if (!localSubscription) {
    throw new Error("Subscription not found");
  }

  await cancelSubscription(localSubscription.id);
  refreshActiveSubscriptions(validatedSession.selectedTeamId);
}

export const cancelSubscriptionAction = traceServerAction('cancelSubscriptionAction', cancelSubscriptionActionImpl);
