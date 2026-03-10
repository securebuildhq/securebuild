"use server"

import { Session } from "@/lib/types/session";
import { getPackage, setDeleteProtection } from "../package";
import { Package } from "@/lib/types/package";

export async function setDeleteProtectionAction(sess: Session, id: string, isDeleteProtectionEnabled: boolean): Promise<Package> {
  const pkg = await getPackage(id);
  if (!pkg) {
    throw new Error("Package not found");
  }

  await setDeleteProtection(id, isDeleteProtectionEnabled);

  const updatedPkg = await getPackage(id);
  return updatedPkg;
}