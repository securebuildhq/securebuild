"use server"

import { Session } from "@/lib/types/session";
import { PackageFamily, UpdatePackageFamilyRequest } from "@/lib/types/packagefamily";
import { updatePackageFamily } from "../packagefamily";

export async function updatePackageFamilyAction(session: Session, id: string, request: UpdatePackageFamilyRequest): Promise<PackageFamily | null> {
  // TODO: Add session validation when implemented
  return await updatePackageFamily(id, request);
}