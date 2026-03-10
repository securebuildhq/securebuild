"use server"

import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { createFreeSubscription } from "@/lib/team/subscription";
import { traceServerAction } from "@/lib/observability/tracing";

async function addFreeSubscriptionActionImpl(sess: Session, catalogItemId: string): Promise<void> {
  const validatedSession = await requireValidSession(sess);

  try {
    await createFreeSubscription(catalogItemId, validatedSession.selectedTeamId);
  } catch (error) {
    console.error("Failed to create free subscription:", error);
    throw error;
  }
}

export const addFreeSubscriptionAction = traceServerAction('addFreeSubscriptionAction', addFreeSubscriptionActionImpl);
