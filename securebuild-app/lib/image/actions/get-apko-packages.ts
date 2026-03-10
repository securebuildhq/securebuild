"use server"

import { Session } from "@/lib/types/session";
import { getAPKOPackages } from "../image";

export interface APKOPackage {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function getAPKOPackagesAction(sess: Session, apkoId: string): Promise<APKOPackage[]> {
  const packages = await getAPKOPackages(apkoId);
  return packages;
}