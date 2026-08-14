"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Builder } from "@/lib/types/builder";
import { listBuilders } from "../builder";


export async function listBuildersAction(isOnDemand?: boolean): Promise<Builder[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const builders = await listBuilders(isOnDemand);
  return builders;
}