"use server"

import { Session } from "@/lib/types/session";
import { optionalValidSession } from "@/lib/utils/session-validation";
import { getScanResults, ScanResult } from "../scan";
import { logger } from "@/lib/utils/logger";
import { getImageByName } from "../image";
import { traceServerAction } from "@/lib/observability/tracing";

async function getScanResultsActionImpl(sess: Session | undefined, imageName: string, tag: string, arch: string): Promise<ScanResult> {
  const validatedSession = await optionalValidSession(sess);


  logger.info("getScanResultsAction", { imageName, tag, arch })
  const image = await getImageByName(imageName);
  if (!image) {
    throw new Error("Image not found");
  }
  const scanResults = await getScanResults(image.name, tag, arch);
  return scanResults;
}

export const getScanResultsAction = traceServerAction('getScanResultsAction', getScanResultsActionImpl);
