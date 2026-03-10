
"use server"

import { Session } from "@/lib/types/session";
import { Team } from "@/lib/types/team";
import { getTeam } from "../team";

export async function getTeamAction(sess: Session, id: string): Promise<Team> {
  const team = await getTeam(id);
  return team;
}