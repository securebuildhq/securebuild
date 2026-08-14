"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { GenerateMelange } from "@/lib/types/melange"
import { logger } from "@/lib/utils/logger"

export async function getGenerateMelangeAction(id: string): Promise<GenerateMelange> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  logger.info("getGenerateMelangeAction", { id })
  throw new Error("AI package generation history is not implemented yet")
}
