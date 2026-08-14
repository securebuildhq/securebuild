"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { setFeaturedCatalogItems } from "../catalog";

export async function setFeaturedCatalogItemsAction(featuredItemIds: string[]) {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await setFeaturedCatalogItems(featuredItemIds);
}