"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { createGodModeNonce } from "../god";

export async function createGodModeNonceAction(teamId: string): Promise<string> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return await createGodModeNonce(teamId, session.user.id);
}