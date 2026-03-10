"use server"

import { Session } from "@/lib/types/session";
import { logger } from "@/lib/utils/logger";
import { checkForUpdates } from "../package";
export async function checkForUpdatesAction(sess: Session, pkgID: string): Promise<void> {
  logger.info(`Checking for updates for package ${pkgID}`)
  await checkForUpdates(pkgID)
}