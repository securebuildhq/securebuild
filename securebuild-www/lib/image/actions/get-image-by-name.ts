"use server"

import { Image } from "@/lib/types/image";
import { Session } from "@/lib/types/session";
import { optionalValidSession } from "@/lib/utils/session-validation";
import { getImageByName } from "../image";
import { traceServerAction } from "@/lib/observability/tracing";

async function getImageByNameActionImpl(sess: Session | undefined, name: string): Promise<Image> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const validatedSession = await optionalValidSession(sess);

  const image = await getImageByName(name);
  return image;
}

export const getImageByNameAction = traceServerAction('getImageByNameAction', getImageByNameActionImpl);