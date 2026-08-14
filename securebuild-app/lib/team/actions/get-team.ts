
"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Team } from "@/lib/types/team";
import { getTeam } from "../team";

export async function getTeamAction(id: string): Promise<Team> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const team = await getTeam(id);
  return team;
}