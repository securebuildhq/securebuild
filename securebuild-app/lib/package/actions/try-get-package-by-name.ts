"use server"

import { Session } from "@/lib/types/session";
import { Package } from "@/lib/types/package";
import { tryGetPackageByName as tryGetPackageByNameDB } from "../package";
import { ValidationError } from "@/lib/errors/validation-error";

export async function tryGetPackageByNameAction(
  sess: Session,
  name: string
): Promise<Package | null> {
  // Validate session
  if (!sess?.user) {
    throw new ValidationError("Unauthorized: Valid session required");
  }

  // Try to get package by name
  return tryGetPackageByNameDB(name);
}
