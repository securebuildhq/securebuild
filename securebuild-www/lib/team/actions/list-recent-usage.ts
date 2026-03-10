"use server"

import { ImageUsage } from "@/lib/types/activity";
import { Session } from "@/lib/types/session";
import { requireValidSession } from "@/lib/utils/session-validation";
import { listRecentUsage } from "../activity";
import { traceServerAction } from "@/lib/observability/tracing";

async function listRecentUsageActionImpl(sess: Session): Promise<ImageUsage[]> {
  const validatedSession = await requireValidSession(sess);

  const imageUsage: ImageUsage[] = [];
  for (let i = 0; i < 7; i++) {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - i);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 1);
    const recentUsage = await listRecentUsage(validatedSession.selectedTeamId, startDate.toISOString(), endDate.toISOString());
    imageUsage.push(recentUsage);
  }
  return imageUsage;
}

export const listRecentUsageAction = traceServerAction('listRecentUsageAction', listRecentUsageActionImpl);
