"use server"

import { Session } from "@/lib/types/session";
import { TeamOverridePricing } from "@/lib/types/team";
import { listTeamCatalogSpecialPricing } from "../team";

export async function listTeamPricingAction(sess: Session, teamId: string): Promise<TeamOverridePricing[]> {
  const pricing = listTeamCatalogSpecialPricing(teamId);
  return pricing;
}