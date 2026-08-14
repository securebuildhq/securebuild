"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { deleteSystemAccount } from "../service-account"

export async function deleteSystemTokenAction(id: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return deleteSystemAccount(id)
}
