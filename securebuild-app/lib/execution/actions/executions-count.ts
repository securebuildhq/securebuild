"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { countFailedExecutions, countFailedExecutionsByType, countRunningExecutions, countSuccessExecutions, countWaitingForVMs } from "../execution";

export interface ExecutionCounts {
  running: number;
  completed: number;
  success: number;
  failed: number;
  failedBreakdown: {
    failed: number;
    timedOut: number;
    stalled: number;
  };
  waitingForVMs: number;
}

export async function executionsCountAction(timePeriod: "1hr" | "4h" | "1d"): Promise<ExecutionCounts> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const success = await countSuccessExecutions(timePeriod)
  const failed = await countFailedExecutions(timePeriod)
  const failedBreakdown = await countFailedExecutionsByType(timePeriod)

  const result = {
    running: await countRunningExecutions(),
    completed: success + failed,
    success,
    failed,
    failedBreakdown,
    waitingForVMs: await countWaitingForVMs(),
  }

  return result;
}
