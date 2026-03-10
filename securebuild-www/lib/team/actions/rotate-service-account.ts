"use server"

import { Session } from "@/lib/types/session";
import { logger } from "@/lib/utils/logger";
import { requireValidSession } from "@/lib/utils/session-validation";
import { listServiceAccounts, rotateServiceAccount } from "../service-account";
import { ServiceAccountWithValue } from "@/lib/types/service-account";
import { traceServerAction } from "@/lib/observability/tracing";

async function rotateServiceAccountActionImpl(sess: Session, serviceAccountId: string): Promise<ServiceAccountWithValue> {
  logger.debug(`rotateServiceAccountAction: ${serviceAccountId}`);
  const validatedSession = await requireValidSession(sess);

  const serviceAccounts = await listServiceAccounts(validatedSession.selectedTeamId);
  const serviceAccount = serviceAccounts.find((sa) => sa.id === serviceAccountId);
  if (!serviceAccount) {
    throw new Error("Service account not found");
  }

  return await rotateServiceAccount(serviceAccount);
}

export const rotateServiceAccountAction = traceServerAction('rotateServiceAccountAction', rotateServiceAccountActionImpl);
