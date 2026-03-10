"use server"

import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { traceServerAction } from "@/lib/observability/tracing";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getCheckoutSessionPriceActionImpl(sess: Session, _catalogItemId: string, _recurring: string): Promise<number> {
  await requireValidSession(sess);
  return 100;
}

export const getCheckoutSessionPriceAction = traceServerAction('getCheckoutSessionPriceAction', getCheckoutSessionPriceActionImpl);
