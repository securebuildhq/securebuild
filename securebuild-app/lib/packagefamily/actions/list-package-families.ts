"use server"

import { Session } from "@/lib/types/session";
import { PackageFamily } from "@/lib/types/packagefamily";
import { listPackageFamilies } from "../packagefamily";

export async function listPackageFamiliesAction(session: Session): Promise<PackageFamily[]> {
  // TODO: Add session validation when implemented
  return await listPackageFamilies();
}