"use server"

import { CatalogItem } from "@/lib/types/catalog";
import { getCatalogItem, getCustomizedPricing } from "../catalog";
import { Session } from "@/lib/types/session";
import { optionalValidSession } from "@/lib/utils/session-validation";
import { traceServerAction } from "@/lib/observability/tracing";

async function getCatalogItemActionImpl(sess: Session | undefined, slug: string): Promise<CatalogItem | null> {
  const validatedSession = await optionalValidSession(sess);
  const catalogItem = await getCatalogItem(slug);

  if (!catalogItem) {
    return null;
  }

  // if the session is valid, check if the user has customized pricing
  if (validatedSession && validatedSession.selectedTeamId) {
    const customizedPricing = await getCustomizedPricing(validatedSession.selectedTeamId, catalogItem.id);
    if (customizedPricing) {
      catalogItem.pricing.monthly = customizedPricing.monthly;
    }
  }
  return catalogItem;
}

export const getCatalogItemAction = traceServerAction('getCatalogItemAction', getCatalogItemActionImpl);
