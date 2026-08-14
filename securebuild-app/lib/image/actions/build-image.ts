"use server"

import { getServerSession } from "@/lib/auth/server-session";
import { enqueueWork } from "@/lib/utils/queue";
import { getImage } from "../image";
import { traceServerAction } from "@/lib/observability/tracing";

async function buildImageActionImpl(id: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await getImage(id);

  await enqueueWork('build_image', {id})
}

export const buildImageAction = traceServerAction('buildImageAction', buildImageActionImpl);
