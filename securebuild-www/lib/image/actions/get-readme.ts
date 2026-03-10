"use server"

import { Session } from "@/lib/types/session";
import { optionalValidSession } from "@/lib/utils/session-validation";
import { getImageReadme } from "../readme";
import { getImageByName } from "../image";
import { traceServerAction } from "@/lib/observability/tracing";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getImageReadmeActionImpl(session: Session | undefined, imageName: string, tag: string, arch: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const validatedSession = await optionalValidSession(session);

  const image = await getImageByName(imageName);
  const readme = await getImageReadme(image.id, tag);
  return readme;
}

export const getImageReadmeAction = traceServerAction('getImageReadmeAction', getImageReadmeActionImpl);