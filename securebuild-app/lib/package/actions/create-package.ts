"use server"

import { getServerSession } from "@/lib/auth/server-session";
import { logger } from "@/lib/utils/logger";
import { createPackage } from "../package";
import { validateMelangeYAML } from "@/lib/melange/validation";
import { AdditionalFiles } from "@/lib/types/package";
import { traceServerAction } from "@/lib/observability/tracing";

async function createPackageActionImpl(
  melangeYaml: string,
  additionalFiles?: AdditionalFiles,
  useRoot?: boolean
): Promise<string> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  // Validate melange YAML
  await validateMelangeYAML(melangeYaml)

  logger.debug("Creating package", {
    userId: session.user.id,
    hasAdditionalFiles: !!additionalFiles
  })

  const createPackageId = await createPackage(melangeYaml, additionalFiles, useRoot, session.user.id, session.user.name)
  return createPackageId
}

export const createPackageAction = traceServerAction('createPackageAction', createPackageActionImpl);
