"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { resumeExecutions } from "../execution";

export async function resumeExecutionsAction(): Promise<boolean> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return resumeExecutions();
}