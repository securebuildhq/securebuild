"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { logger } from "@/lib/utils/logger";
import { createGenerateApko } from "../apko";

export interface GenerateApkoResult {
  id?: string;
  isFailed: boolean;
  errorMessage?: string;
}


export async function generateApkoAction(melangeYaml: string): Promise<GenerateApkoResult> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  logger.debug("Generating apko action", { userId: session.user.id, sessionId: session.id });
  const generate = await createGenerateApko(session.user.id, session.id, melangeYaml)
  return {
    id: generate.id,
    isFailed: false,
  }
}

