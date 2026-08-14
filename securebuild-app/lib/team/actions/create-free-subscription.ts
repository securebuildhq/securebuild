"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { createFreeSubscription, refreshActiveSubscriptions } from "../team";

export async function createFreeSubscriptionAction(teamId: string, catalogItemId: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await createFreeSubscription(catalogItemId, teamId);
  // Sync with Stripe to update local subscription data
  await refreshActiveSubscriptions(teamId);
} 