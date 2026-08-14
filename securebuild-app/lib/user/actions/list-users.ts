"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { listUsersWithTeams, UserWithTeam } from "../user";

export async function listUsersAction(): Promise<UserWithTeam[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const users = await listUsersWithTeams();
  return users;
}
