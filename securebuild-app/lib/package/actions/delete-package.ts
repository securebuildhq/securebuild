"use server"

import { Session } from "@/lib/types/session";
import { enqueueWork } from "@/lib/utils/queue";
import { getPackage } from "../package";
import { ValidationError } from "@/lib/errors/validation-error";

export async function deletePackageAction(sess: Session, id: string): Promise<boolean> {
  // Validate session
  if (!sess?.user) {
    throw new ValidationError("Unauthorized: Valid session required");
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