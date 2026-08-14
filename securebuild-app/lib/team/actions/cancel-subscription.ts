"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { cancelSubscription, refreshActiveSubscriptions } from "../team";

export async function cancelSubscriptionAction(teamId: string, subscriptionId: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await cancelSubscription(subscriptionId);
  // Refresh subscriptions to update local database
  await refreshActiveSubscriptions(teamId);
} 