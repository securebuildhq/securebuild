"use server"

import { Session } from "@/lib/types/session";
import { listUsersWithTeams, UserWithTeam } from "../user";

export async function listUsersAction(sess: Session): Promise<UserWithTeam[]> {
  const users = await listUsersWithTeams();
  return users;
}
