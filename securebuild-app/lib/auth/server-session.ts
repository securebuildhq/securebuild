"use server";

import { cookies } from "next/headers";
import { headers } from "next/headers";
import { validateSession } from "./actions/validate-session";
import { Session } from "@/lib/types/session";
import { validateBearerAuthorization } from "./middleware/bearer-auth";

export async function getServerSession(): Promise<Session | undefined> {
  // `headers()` is available for real Server Action and route requests. Some
  // direct action tests only provide a cookie mock, so absence of request
  // headers should still allow the normal cookie path below.
  try {
    const headersList = await headers();
    const bearerSession = await validateBearerAuthorization(headersList.get("authorization"));
    if (bearerSession) {
      return bearerSession;
    }
  } catch (error) {
    if (!(error instanceof TypeError) && !(error instanceof Error && error.message.includes("outside a request scope"))) {
      throw error;
    }
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("buildadmin_session")?.value;
  
  if (!sessionToken) {
    return undefined;
  }
  
  try {
    return await validateSession(sessionToken);
  } catch (error) {
    console.error("Failed to validate session in server component:", error);
    return undefined;
  }
}
