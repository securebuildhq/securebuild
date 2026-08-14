"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { PackageFamily } from "@/lib/types/packagefamily";
import { createLinkedPackageFamily } from "../packagefamily";

export async function createLinkedPackageFamilyAction(
  request: { name: string; gitRemote: string; melangeFilePath: string; initialTag: string }
): Promise<PackageFamily> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }


  if (!request.name?.trim()) {
    throw new Error("Name is required");
  }
  if (!request.gitRemote?.trim()) {
    throw new Error("Git remote is required");
  }
  if (!request.melangeFilePath?.trim()) {
    throw new Error("Melange file path is required");
  }
  if (!request.initialTag?.trim()) {
    throw new Error("Initial tag is required");
  }

  return await createLinkedPackageFamily(request);
}
