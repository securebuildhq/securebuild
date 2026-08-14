"use server";

import { listUsers } from "@/lib/auth/user";
import { User } from "@/lib/types/user";
import { getServerSession } from "@/lib/auth/server-session";

export async function listAdminUsers(): Promise<User[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return listUsers();
}
