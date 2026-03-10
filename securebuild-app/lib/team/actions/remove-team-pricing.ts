"use server"

import { Session } from "@/lib/types/session";
import { removeTeamCatalogSpecialPricing } from "../team";

export async function removeTeamPricingAction(sess: Session, teamId: string, catalogItemId: string): Promise<void> {
  await removeTeamCatalogSpecialPricing(teamId, catalogItemId);
}