"use server"

import { Session } from "@/lib/types/session";
import { optionalValidSession } from "@/lib/utils/session-validation";
import { getSbom } from "../sbom";
import { traceServerAction } from "@/lib/observability/tracing";

async function getSbomActionImpl(sess: Session | undefined, imageName: string, tag: string, arch: string): Promise<any> {
  // During build time, return empty SBOM if no DB connection
  if (typeof window === 'undefined' && process.env.NODE_ENV === 'production' && !process.env.DB_URI && !process.env.SECUREBUILD_PG_URI) {
    return '{"packages": []}';
  }

  const validatedSession = await optionalValidSession(sess);

  return getSbom(imageName, tag, arch);
}

export const getSbomAction = traceServerAction('getSbomAction', getSbomActionImpl);
