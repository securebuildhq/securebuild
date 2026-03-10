"use server"

import { getPackageReleases, PackageRelease } from "../package";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

async function getPackageReleasesActionImpl(
  packageName: string
): Promise<PackageRelease[]> {
  try {
    logger.info("Getting package releases", { packageName });

    const releases = await getPackageReleases(packageName);

    return releases;
  } catch (error) {
    logger.error("Error in getPackageReleasesAction", error, { packageName });
    throw error;
  }
}

export const getPackageReleasesAction = traceServerAction('getPackageReleasesAction', getPackageReleasesActionImpl);
