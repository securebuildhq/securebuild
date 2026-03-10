"use server"

import { Session } from "@/lib/types/session";
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

export async function executionsCountAction(sess: Session, timePeriod: "1hr" | "4h" | "1d"): Promise<ExecutionCounts> {
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
