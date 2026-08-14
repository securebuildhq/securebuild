"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { deleteBuilder } from "../builder";

export async function deleteBuilderAction(id: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await deleteBuilder(id)
}
