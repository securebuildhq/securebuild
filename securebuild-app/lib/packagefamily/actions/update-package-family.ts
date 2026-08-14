"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { PackageFamily, UpdatePackageFamilyRequest } from "@/lib/types/packagefamily";
import { updatePackageFamily } from "../packagefamily";

export async function updatePackageFamilyAction(id: string, request: UpdatePackageFamilyRequest): Promise<PackageFamily | null> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  // TODO: Add session validation when implemented
  return await updatePackageFamily(id, request);
}