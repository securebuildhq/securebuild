"use server"

import { Session } from "@/lib/types/session";
import { cancelSubscription, refreshActiveSubscriptions } from "../team";

export async function cancelSubscriptionAction(sess: Session, teamId: string, subscriptionId: string): Promise<void> {
  await cancelSubscription(subscriptionId);
  // Refresh subscriptions to update local database
  await refreshActiveSubscriptions(teamId);
} 