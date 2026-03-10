"use server"

import { Session } from "@/lib/types/session";
import { withdrawPackage } from "../package";
import { ValidationError } from "@/lib/errors/validation-error";

export async function withdrawPackageAction(
  sess: Session,
  filename: string
): Promise<void> {
  // Validate session
  if (!sess?.user) {
    throw new ValidationError("Unauthorized: Valid session required");
  }

  // Validate input parameters
  if (!filename?.trim()) {
    throw new ValidationError("Filename is required");
  }

  // Trim filename to ensure it matches database records
  const trimmedFilename = filename.trim();

  // Call the core withdraw function
  await withdrawPackage(trimmedFilename);
}
