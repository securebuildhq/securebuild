'use server'

import { Session } from "@/lib/types/session"
import { getUpstreamConfigFromLatestPackage, getUpstreamConfigFromPackage, UpstreamConfig } from "../packagefamily"

export async function getUpstreamConfigAction(
  session: Session,
  packageFamilyId: string
): Promise<UpstreamConfig | null> {
  if (!session) {
    throw new Error("Unauthorized")
  }

  return await getUpstreamConfigFromLatestPackage(packageFamilyId)
}

export async function getUpstreamConfigFromPackageAction(
  session: Session,
  packageId: string
): Promise<UpstreamConfig | null> {
  if (!session) {
    throw new Error("Unauthorized")
  }

  return await getUpstreamConfigFromPackage(packageId)
}
