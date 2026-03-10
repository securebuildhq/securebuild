"use server";

import { Session } from "@/lib/types/session";
import { listTeams } from "@/lib/team/team";
import { Team } from "@/lib/types/team";

export async function listTeamsAction(sess: Session): Promise<Team[]> {
  const teams = await listTeams();
  return teams;
}