"use server"

import { Session } from "@/lib/types/session"
import { GenerateMelange } from "@/lib/types/melange"
import { logger } from "@/lib/utils/logger"

export async function getGenerateMelangeAction(sess: Session, id: string): Promise<GenerateMelange> {
  logger.info("getGenerateMelangeAction", { id })
  throw new Error("AI package generation history is not implemented yet")
}
