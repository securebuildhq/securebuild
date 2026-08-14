"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getImagePackages } from "../image";

export interface ImagePackage {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function getImagePackagesAction(imageId: string): Promise<ImagePackage[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const packages = await getImagePackages(imageId);
  return packages;
}