import { getPackageByNameAction } from "@/lib/package/actions/get-package-by-name";
import { enqueueWork } from "@/lib/utils/queue";
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
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
    const { packageName } = body;

    if (!packageName) {
      return NextResponse.json(
        { error: "packageName is required" },
        { status: 400 }
      );
    }

    const pkg = await getPackageByNameAction(packageName);
    if (!pkg) {
      return NextResponse.json(
        { error: "Package not found" },
        { status: 404 }
      );
    }

    await enqueueWork("build_package", { packageId: pkg.id });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error rebuilding package:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}