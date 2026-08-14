"use server";

import { getServerSession } from "@/lib/auth/server-session";

import { listTeams } from "@/lib/team/team";
import { Team } from "@/lib/types/team";

export async function listTeamsAction(): Promise<Team[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const teams = await listTeams();
  return teams;
}