"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { PackageFamily, CreatePackageFamilyRequest } from "@/lib/types/packagefamily";
import { createPackageFamily } from "../packagefamily";

export async function createPackageFamilyAction(request: CreatePackageFamilyRequest): Promise<PackageFamily> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  // TODO: Add session validation when implemented
  return await createPackageFamily(request);
}