"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { listTeamSubscriptions } from "../team";
import { TeamSubscription } from "@/lib/types/team";

export async function listTeamSubscriptionsAction(teamId: string): Promise<TeamSubscription[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return await listTeamSubscriptions(teamId);
} 