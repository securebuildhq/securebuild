"use server";

import { logger } from "@/lib/utils/logger";
import { createAndSendMagicLink } from "@/lib/user/magic-link";
import { traceServerAction } from "@/lib/observability/tracing";

async function sendMagicLinkActionImpl(email: string): Promise<void> {
  console.log("sendMagicLinkAction", email);
  try {
    await createAndSendMagicLink(email);
  } catch (error) {
    console.log("error", error);
    logger.error("Failed to send magic link", { error });
    throw error;
  }
}

export const sendMagicLinkAction = traceServerAction('sendMagicLinkAction', sendMagicLinkActionImpl);
