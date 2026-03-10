"use server"

import { Session } from "@/lib/types/session";
import { logger } from "@/lib/utils/logger";
import { createGenerateApko } from "../apko";

export interface GenerateApkoResult {
  id?: string;
  isFailed: boolean;
  errorMessage?: string;
}


export async function generateApkoAction(sess: Session, melangeYaml: string): Promise<GenerateApkoResult> {
  logger.debug("Generating apko action", { userId: sess.user.id, sessionId: sess.id });
  const generate = await createGenerateApko(sess.user.id, sess.id, melangeYaml)
  return {
    id: generate.id,
    isFailed: false,
  }
}

