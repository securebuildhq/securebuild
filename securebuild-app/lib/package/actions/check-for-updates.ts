"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { logger } from "@/lib/utils/logger";
import { checkForUpdates } from "../package";
export async function checkForUpdatesAction(pkgID: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  logger.info(`Checking for updates for package ${pkgID}`)
  await checkForUpdates(pkgID)
}