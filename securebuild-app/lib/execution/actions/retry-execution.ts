"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getExecution } from "../execution";
import { enqueueWork } from "@/lib/utils/queue";
import { getPackageVersion } from "@/lib/package/package";

export async function retryExecutionAction(id: string): Promise<boolean> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const lastExecution = await getExecution(id);
  const pgvVersion = await getPackageVersion(lastExecution.packageId, lastExecution.versionLabel, lastExecution.apkRelease);

  await enqueueWork('build_package', {
    packageId: lastExecution.packageId,
    packageVersionId: pgvVersion.id,
    cause: lastExecution.cause,
    causeId: lastExecution.causeId,
  })

  return true;
}