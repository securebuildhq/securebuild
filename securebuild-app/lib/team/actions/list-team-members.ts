"use server"

import { Session } from "@/lib/types/session";
import { listTeamMembers } from "../team";
import { TeamMember } from "@/lib/types/team";

export async function listTeamMembersAction(sess: Session, id: string): Promise<TeamMember[]> {
    const members = await listTeamMembers(id);
    return members;
}