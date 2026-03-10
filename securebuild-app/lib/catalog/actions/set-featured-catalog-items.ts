"use server"

import { Session } from "@/lib/types/session";
import { setFeaturedCatalogItems } from "../catalog";

export async function setFeaturedCatalogItemsAction(sess: Session, featuredItemIds: string[]) {
  await setFeaturedCatalogItems(featuredItemIds);
}