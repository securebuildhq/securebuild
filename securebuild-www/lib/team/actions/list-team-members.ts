"use server"

import { Session } from "@/lib/types/session";
import { User } from "@/lib/types/user";
import { requireValidSession } from "@/lib/utils/session-validation";
import { traceServerAction } from "@/lib/observability/tracing";
import { listTeamUsers } from "../team";

async function listTeamMembersActionImpl(sess: Session): Promise<User[]> {
  const validatedSession = await requireValidSession(sess);
  const users = await listTeamUsers(validatedSession.selectedTeamId);
  return users;
}

export const listTeamMembersAction = traceServerAction('listTeamMembersAction', listTeamMembersActionImpl);