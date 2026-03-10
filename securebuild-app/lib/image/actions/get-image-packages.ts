"use server"

import { Session } from "@/lib/types/session";
import { getImagePackages } from "../image";

export interface ImagePackage {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function getImagePackagesAction(sess: Session, imageId: string): Promise<ImagePackage[]> {
  const packages = await getImagePackages(imageId);
  return packages;
}