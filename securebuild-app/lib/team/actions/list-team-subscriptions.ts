"use server"

import { Session } from "@/lib/types/session";
import { listTeamSubscriptions } from "../team";
import { TeamSubscription } from "@/lib/types/team";

export async function listTeamSubscriptionsAction(sess: Session, teamId: string): Promise<TeamSubscription[]> {
  return await listTeamSubscriptions(teamId);
} 