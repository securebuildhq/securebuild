"use server"

import { ServiceAccount } from "@/lib/types/service-account";
import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { listServiceAccounts } from "../service-account";
import { traceServerAction } from "@/lib/observability/tracing";

async function listServiceAccountsActionImpl(sess: Session): Promise<ServiceAccount[]> {
    const validatedSession = await requireValidSession(sess);
    const serviceAccounts = await listServiceAccounts(validatedSession.selectedTeamId)
    return serviceAccounts
}

export const listServiceAccountsAction = traceServerAction('listServiceAccountsAction', listServiceAccountsActionImpl);
