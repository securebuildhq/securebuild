"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { withdrawPackage } from "../package";
import { ValidationError } from "@/lib/errors/validation-error";

export async function withdrawPackageAction(
  filename: string
): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
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
