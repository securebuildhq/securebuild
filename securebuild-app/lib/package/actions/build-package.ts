"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getPackage, getPackageVersion } from "../package";
import { enqueueWork } from "@/lib/utils/queue";
import { logger } from "@/lib/utils/logger";

export async function buildPackageAction(id: string): Promise<boolean> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }


  logger.info("Rebuilding individual package", { id })
  const pkg = await getPackage(id)
  if (!pkg) {
    throw new Error("Package not found")
  }

  await enqueueWork("build_package", { packageId: id, cause: `built by ${session.user.name}`, causeId: session.user.id })
  return true
}

export async function buildPackageVersionAction(packageId: string, version: string, apkRelease: number): Promise<boolean> {
  const session = await getServerSession();
  if (!session) {
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
    cause: `built by ${session.user.name}`,
    causeId: session.user.id
  })

  return true
}
