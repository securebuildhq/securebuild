"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { removeTeamCatalogSpecialPricing } from "../team";

export async function removeTeamPricingAction(teamId: string, catalogItemId: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await removeTeamCatalogSpecialPricing(teamId, catalogItemId);
}