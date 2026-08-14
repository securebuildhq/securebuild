"use server"

import { getServerSession } from "@/lib/auth/server-session";


export async function searchReposAction(query: string): Promise<any[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return [];
}
