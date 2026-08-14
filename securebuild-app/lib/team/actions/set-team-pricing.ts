"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { setTeamCatalogSpecialPricing } from "../team";

export async function setTeamPricingAction(teamId: string, catalogItemId: string, priceMonthly: number): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await setTeamCatalogSpecialPricing(teamId, catalogItemId, priceMonthly);
}