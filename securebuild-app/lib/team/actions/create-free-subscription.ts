"use server"

import { Session } from "@/lib/types/session";
import { createFreeSubscription, refreshActiveSubscriptions } from "../team";

export async function createFreeSubscriptionAction(sess: Session, teamId: string, catalogItemId: string): Promise<void> {
  await createFreeSubscription(catalogItemId, teamId);
  // Sync with Stripe to update local subscription data
  await refreshActiveSubscriptions(teamId);
} 