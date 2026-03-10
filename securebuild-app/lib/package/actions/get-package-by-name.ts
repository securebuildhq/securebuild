"use server"

import { Session } from "@/lib/types/session";
import { Package } from "@/lib/types/package";
import { getPackageByName as getPackageByNameDB } from "../package";
import { ValidationError } from "@/lib/errors/validation-error";

export async function getPackageByNameAction(
  sess: Session,
  name: string
): Promise<Package> {
  // Validate session
  if (!sess?.user) {
    throw new ValidationError("Unauthorized: Valid session required");
  }

  // Get package by name
  return getPackageByNameDB(name);
}
