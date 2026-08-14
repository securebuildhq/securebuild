"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { isExecutionPaused } from "../execution";

export async function isExecutionPausedAction(): Promise<boolean> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return isExecutionPaused();
}