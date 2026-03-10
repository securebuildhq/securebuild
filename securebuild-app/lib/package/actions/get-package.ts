"use server"

import { Session } from "@/lib/types/session";
import { getPackage } from "../package";
import { Package } from "@/lib/types/package";

export async function getPackageAction(sess: Session, id: string): Promise<Package> {
  const pkg = await getPackage(id);
  return pkg;
}