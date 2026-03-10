"use server"

import { ServiceAccountWithValue } from "@/lib/types/service-account";
import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { createServiceAccount } from "../service-account";
import { traceServerAction } from "@/lib/observability/tracing";

async function createServiceAccountActionImpl(sess: Session, name: string, expiresIn: string): Promise<ServiceAccountWithValue> {
  const validatedSession = await requireValidSession(sess);
  const serviceAccount = await createServiceAccount(validatedSession.selectedTeamId, name, expiresIn);
  return serviceAccount;
}

export const createServiceAccountAction = traceServerAction('createServiceAccountAction', createServiceAccountActionImpl);
