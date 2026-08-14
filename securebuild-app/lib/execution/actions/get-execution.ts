"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Execution } from "@/lib/types/execution";
import { getExecution } from "../execution";

export async function getExecutionAction(id: string): Promise<Execution> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const execution = await getExecution(id);
  return execution;
}