"use server"

import { Session } from "@/lib/types/session";
import { logger } from "@/lib/utils/logger";
import { requireValidSession } from "@/lib/utils/session-validation";
import { listServiceAccounts, renameServiceAccount } from "../service-account";
import { traceServerAction } from "@/lib/observability/tracing";

async function renameServiceAccountActionImpl(sess: Session, serviceAccountId: string, newName: string): Promise<void> {
  logger.debug(`renameServiceAccountAction: ${serviceAccountId} -> ${newName}`);
  const validatedSession = await requireValidSession(sess);

  const serviceAccounts = await listServiceAccounts(validatedSession.selectedTeamId);
  const serviceAccount = serviceAccounts.find((sa) => sa.id === serviceAccountId);
  if (!serviceAccount) {
    throw new Error("Service account not found");
  }

  if (serviceAccount.name === newName) {
    throw new Error("Service account name is already set to the new name");
  }

  await renameServiceAccount(serviceAccountId, newName);
}

export const renameServiceAccountAction = traceServerAction('renameServiceAccountAction', renameServiceAccountActionImpl);
