"use server"

import { Session } from "@/lib/types/session";
import { getPackage, getPackageVersion } from "../package";
import { enqueueWork } from "@/lib/utils/queue";
import { logger } from "@/lib/utils/logger";

export async function buildPackageAction(sess: Session, id: string): Promise<boolean> {
  // Validate session
  if (!sess?.user) {
    throw new Error("Unauthorized: Valid session required");
  }

  logger.info("Rebuilding individual package", { id })
  const pkg = await getPackage(id)
  if (!pkg) {
    throw new Error("Package not found")
  }

  await enqueueWork("build_package", { packageId: id, cause: `built by ${sess.user.name}`, causeId: sess.user.id })
  return true
}

export async function buildPackageVersionAction(sess: Session, packageId: string, version: string, apkRelease: number): Promise<boolean> {
  // Validate session
  if (!sess?.user) {
    throw new Error("Unauthorized: Valid session required");
  }

  logger.info("Building specific package version", { packageId, version, apkRelease })

  const pkg = await getPackage(packageId)
  if (!pkg) {
    throw new Error("Package not found")
  }

  const pkgVersion = await getPackageVersion(packageId, version, apkRelease)
  if (!pkgVersion) {
    throw new Error("Package version not found")
  }

  await enqueueWork("build_package", {
    packageId,
    packageVersionId: pkgVersion.id,
    cause: `built by ${sess.user.name}`,
    causeId: sess.user.id
  })

  return true
}
