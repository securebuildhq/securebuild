"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { TeamOverridePricing } from "@/lib/types/team";
import { listTeamCatalogSpecialPricing } from "../team";

export async function listTeamPricingAction(teamId: string): Promise<TeamOverridePricing[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const pricing = listTeamCatalogSpecialPricing(teamId);
  return pricing;
}