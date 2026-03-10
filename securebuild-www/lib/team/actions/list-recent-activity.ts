"use server"

import { Activity } from "@/lib/types/activity";
import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { listTeamRecentActivity } from "../activity";
import { traceServerAction } from "@/lib/observability/tracing";

async function listTeamRecentActivityActionImpl(sess: Session): Promise<Activity[]> {
  const validatedSession = await requireValidSession(sess);
  const activities = await listTeamRecentActivity(validatedSession.selectedTeamId, 10);
  return activities;
}

export const listTeamRecentActivityAction = traceServerAction('listTeamRecentActivityAction', listTeamRecentActivityActionImpl);

