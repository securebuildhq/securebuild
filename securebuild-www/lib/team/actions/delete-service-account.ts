"use server"

import { logger } from "@/lib/utils/logger";
import { Session } from "@/lib/types/session";
import { deleteServiceAccount, listServiceAccounts } from "../service-account";
import { requireValidSession } from "@/lib/utils/session-validation";
import { traceServerAction } from "@/lib/observability/tracing";

async function deleteServiceAccountActionImpl(sess: Session, serviceAccountId: string): Promise<void> {
  logger.debug(`deleteServiceAccountAction: ${serviceAccountId}`);
  const validatedSession = await requireValidSession(sess);

  const serviceAccounts = await listServiceAccounts(validatedSession.selectedTeamId);
  const serviceAccount = serviceAccounts.find((sa) => sa.id === serviceAccountId);
  if (!serviceAccount) {
    throw new Error("Service account not found");
  }

  await deleteServiceAccount(serviceAccount);
}

export const deleteServiceAccountAction = traceServerAction('deleteServiceAccountAction', deleteServiceAccountActionImpl);
