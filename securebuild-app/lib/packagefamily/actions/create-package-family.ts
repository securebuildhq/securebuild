"use server"

import { Session } from "@/lib/types/session";
import { PackageFamily, CreatePackageFamilyRequest } from "@/lib/types/packagefamily";
import { createPackageFamily } from "../packagefamily";

export async function createPackageFamilyAction(session: Session, request: CreatePackageFamilyRequest): Promise<PackageFamily> {
  // TODO: Add session validation when implemented
  return await createPackageFamily(request);
}