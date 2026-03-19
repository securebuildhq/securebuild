"use server";

import { listUsers } from "@/lib/auth/user";
import { User } from "@/lib/types/user";

export async function listAdminUsers(): Promise<User[]> {
  return listUsers();
}
