"use server"

import { Session } from "@/lib/types/session";
import { enqueueWork } from "@/lib/utils/queue";
import { getImage } from "../image";
import { traceServerAction } from "@/lib/observability/tracing";

async function buildImageActionImpl(sess: Session, id: string): Promise<void> {
  await getImage(id);

  await enqueueWork('build_image', {id})
}

export const buildImageAction = traceServerAction('buildImageAction', buildImageActionImpl);