"use server";

import { cookies } from "next/headers";
import { validateSession } from "./actions/validate-session";
import { Session } from "@/lib/types/session";

export async function getServerSession(): Promise<Session | undefined> {
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
