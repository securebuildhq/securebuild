"use server"

import { Session } from "@/lib/types/session";
import { pauseExecutions } from "../execution";

export async function pauseExecutionsAction(sess: Session): Promise<boolean> {
  return pauseExecutions();
}
