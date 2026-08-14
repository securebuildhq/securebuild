'use server'

import { getServerSession } from "@/lib/auth/server-session";

import { getUpstreamConfigFromLatestPackage, getUpstreamConfigFromPackage, UpstreamConfig } from "../packagefamily"

export async function getUpstreamConfigAction(
  packageFamilyId: string
): Promise<UpstreamConfig | null> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  if (!session) {
    throw new Error("Unauthorized")
  }

  return await getUpstreamConfigFromLatestPackage(packageFamilyId)
}

export async function getUpstreamConfigFromPackageAction(
  packageId: string
): Promise<UpstreamConfig | null> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  if (!session) {
    throw new Error("Unauthorized")
  }

  return await getUpstreamConfigFromPackage(packageId)
}
