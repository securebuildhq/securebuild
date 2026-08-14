import { tryGetPackageByNameAction } from "@/lib/package/actions/try-get-package-by-name";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server-session";
import { getSessionWithBearer } from "@/lib/auth/middleware/bearer-auth";

export async function POST(request: NextRequest) {
  try {
    // Get and validate session (supports both bearer token and session cookie)
    const session = await getSessionWithBearer(request, getServerSession);
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized: Valid session or bearer token required" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { packageNames } = body;

    // Validate that packageNames is an array
    if (!Array.isArray(packageNames)) {
      return NextResponse.json(
        { error: "packageNames must be an array" },
        { status: 400 }
      );
    }

    // Check each package and build results object
    const results: { [packageName: string]: boolean } = {};

    for (const packageName of packageNames) {
      const pkg = await tryGetPackageByNameAction(packageName);
      results[packageName] = pkg !== null;
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Error checking packages:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}