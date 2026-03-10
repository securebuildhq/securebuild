"use server"

import { Session } from "@/lib/types/session";
import { setTeamCatalogSpecialPricing } from "../team";

export async function setTeamPricingAction(sess: Session, teamId: string, catalogItemId: string, priceMonthly: number): Promise<void> {
  await setTeamCatalogSpecialPricing(teamId, catalogItemId, priceMonthly);
}