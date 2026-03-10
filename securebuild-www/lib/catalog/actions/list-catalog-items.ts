"use server"

import { CatalogItem } from "@/lib/types/catalog";
import { getCustomizedPricing, listCatalogItems } from "../catalog";
import { Session } from "@/lib/types/session";
import { optionalValidSession } from "@/lib/utils/session-validation";
import { traceServerAction } from "@/lib/observability/tracing";

async function listCatalogItemsActionImpl(sess: Session | undefined): Promise<CatalogItem[]> {
  const validatedSession = await optionalValidSession(sess);

  const catalogItems = await listCatalogItems();

  if (validatedSession && validatedSession.selectedTeamId) {
    for (const catalogItem of catalogItems) {
      const customizedPricing = await getCustomizedPricing(validatedSession.selectedTeamId, catalogItem.id);
      if (customizedPricing) {
        catalogItem.pricing.monthly = customizedPricing.monthly;
      }
    }
  }
  return catalogItems;
}

export const listCatalogItemsAction = traceServerAction('listCatalogItemsAction', listCatalogItemsActionImpl);
