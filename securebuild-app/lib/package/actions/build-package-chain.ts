"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getPackage } from "../package";
import { enqueueWork } from "@/lib/utils/queue";
import { logger } from "@/lib/utils/logger";

export async function buildPackageChainAction(pkgId: string): Promise<boolean> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  logger.info("Building package chain", { pkgId })
  
  const pkg = await getPackage(pkgId);
  if (!pkg) {
    throw new Error("Package not found");
  }
  
  // Trigger the package chain build
  await enqueueWork("build_package_chain", { packageId: pkgId });
  
  return true;
}