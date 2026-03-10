"use server"

import { Session } from "@/lib/types/session";
import { isExecutionPaused } from "../execution";

export async function isExecutionPausedAction(sess: Session): Promise<boolean> {
  return isExecutionPaused();
}