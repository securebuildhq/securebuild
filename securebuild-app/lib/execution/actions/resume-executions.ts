"use server"

import { Session } from "@/lib/types/session";
import { resumeExecutions } from "../execution";

export async function resumeExecutionsAction(sess: Session): Promise<boolean> {
  return resumeExecutions();
}