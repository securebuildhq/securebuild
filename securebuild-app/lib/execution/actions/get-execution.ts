"use server"

import { Execution } from "@/lib/types/execution";
import { Session } from "@/lib/types/session";
import { getExecution } from "../execution";

export async function getExecutionAction(sess: Session, id: string): Promise<Execution> {
  const execution = await getExecution(id);
  return execution;
}