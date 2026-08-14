"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { listTeamMembers } from "../team";
import { TeamMember } from "@/lib/types/team";

export async function listTeamMembersAction(id: string): Promise<TeamMember[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

    const members = await listTeamMembers(id);
    return members;
}