"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { pauseExecutions } from "../execution";

export async function pauseExecutionsAction(): Promise<boolean> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return pauseExecutions();
}
