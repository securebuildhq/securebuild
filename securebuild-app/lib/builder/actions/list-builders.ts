"use server"

import { Builder } from "@/lib/types/builder";
import { Session } from "@/lib/types/session";
import { listBuilders } from "../builder";


export async function listBuildersAction(sess: Session, isOnDemand?: boolean): Promise<Builder[]> {
  const builders = await listBuilders(isOnDemand);
  return builders;
}