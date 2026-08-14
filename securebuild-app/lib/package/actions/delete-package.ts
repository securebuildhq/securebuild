"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { enqueueWork } from "@/lib/utils/queue";
import { getPackage } from "../package";
import { ValidationError } from "@/lib/errors/validation-error";

export async function deletePackageAction(id: string): Promise<boolean> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }


  // Validate input parameters
  if (!id?.trim()) {
    throw new ValidationError("Package ID is required");
  }

  // Get package and check delete protection
  const pkg = await getPackage(id);

  // Check delete protection
  if (pkg.isDeleteProtectionEnabled) {
    throw new ValidationError("Cannot delete package: delete protection is enabled", 403);
  }

  await enqueueWork(
    "remove_package",
    {
      packageId: id,
    }
  )

  return true;
}