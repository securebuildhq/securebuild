"use server"

import { PackageVersion } from "@/lib/types/package";
import { Session } from "@/lib/types/session";
import { createPackageVersion } from "../package";

export async function createPackageVersionAction(sess: Session, pkgId: string, version: string): Promise<PackageVersion> {
    const pkgVersion = await createPackageVersion(pkgId, version);
    return pkgVersion;
}