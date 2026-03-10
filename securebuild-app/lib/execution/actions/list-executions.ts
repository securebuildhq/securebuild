"use server"

import { Execution } from "@/lib/types/execution";
import { Session } from "@/lib/types/session";
import { listExecutions, ExecutionFilters } from "../execution";

// Define a type for the serialized execution data
export type SerializedExecution = Omit<Execution, 'createdAt' | 'x86_64BuildStartedAt' | 'x86_64BuildFinishedAt' | 'aarch64BuildStartedAt' | 'aarch64BuildFinishedAt'> & {
  createdAt: string;
  completedAt: string | null;
  x86_64BuildStartedAt: string | null;
  x86_64BuildFinishedAt: string | null;
  aarch64BuildStartedAt: string | null;
  aarch64BuildFinishedAt: string | null;
};

export async function listExecutionsAction(sess: Session, filters: ExecutionFilters = {}, pagination?: { page?: number; limit?: number }): Promise<{ executions: SerializedExecution[]; totalCount: number }> {
  const { executions: executionsFromDb, totalCount } = await listExecutions(filters, pagination);

  // Ensure dates are serialized as ISO strings before sending to the client
  const serializedExecutions = executionsFromDb.map(exec => {
    // Calculate completedAt as the latest of the two build finish times
    let completedAt: string | null = null;
    if (exec.x86_64BuildFinishedAt && exec.aarch64BuildFinishedAt) {
      const x86FinishTime = exec.x86_64BuildFinishedAt.getTime();
      const armFinishTime = exec.aarch64BuildFinishedAt.getTime();
      completedAt = new Date(Math.max(x86FinishTime, armFinishTime)).toISOString();
    } else if (exec.x86_64BuildFinishedAt) {
      completedAt = exec.x86_64BuildFinishedAt.toISOString();
    } else if (exec.aarch64BuildFinishedAt) {
      completedAt = exec.aarch64BuildFinishedAt.toISOString();
    }

    return {
      ...exec,
      createdAt: exec.createdAt.toISOString(),
      completedAt,
      x86_64BuildStartedAt: exec.x86_64BuildStartedAt ? exec.x86_64BuildStartedAt.toISOString() : null,
      x86_64BuildFinishedAt: exec.x86_64BuildFinishedAt ? exec.x86_64BuildFinishedAt.toISOString() : null,
      aarch64BuildStartedAt: exec.aarch64BuildStartedAt ? exec.aarch64BuildStartedAt.toISOString() : null,
      aarch64BuildFinishedAt: exec.aarch64BuildFinishedAt ? exec.aarch64BuildFinishedAt.toISOString() : null,
    };
  });

  return { executions: serializedExecutions, totalCount };
}
