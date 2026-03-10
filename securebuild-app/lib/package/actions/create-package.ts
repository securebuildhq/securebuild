"use server"

import { Session } from "@/lib/types/session";
import { logger } from "@/lib/utils/logger";
import { createPackage } from "../package";
import { validateMelangeYAML } from "@/lib/melange/validation";
import { AdditionalFiles } from "@/lib/types/package";
import { traceServerAction } from "@/lib/observability/tracing";

async function createPackageActionImpl(
  sess: Session,
  melangeYaml: string,
  additionalFiles?: AdditionalFiles,
  useRoot?: boolean
): Promise<string> {
  // Validate session
  if (!sess?.user) {
    throw new Error("Unauthorized: Valid session required");
  }

  // Validate melange YAML
  await validateMelangeYAML(melangeYaml)

  logger.debug("Creating package", {
    userId: sess.user.id,
    hasAdditionalFiles: !!additionalFiles
  })

  const createPackageId = await createPackage(melangeYaml, additionalFiles, useRoot, sess.user.id, sess.user.name)
  return createPackageId
}

export const createPackageAction = traceServerAction('createPackageAction', createPackageActionImpl);
