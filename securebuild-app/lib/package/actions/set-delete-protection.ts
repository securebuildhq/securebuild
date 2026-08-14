"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getPackage, setDeleteProtection } from "../package";
import { Package } from "@/lib/types/package";

export async function setDeleteProtectionAction(id: string, isDeleteProtectionEnabled: boolean): Promise<Package> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const pkg = await getPackage(id);
  if (!pkg) {
    throw new Error("Package not found");
  }

  await setDeleteProtection(id, isDeleteProtectionEnabled);

  const updatedPkg = await getPackage(id);
  return updatedPkg;
}