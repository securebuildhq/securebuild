import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server-session";
import { getAPKOPackages } from "@/lib/image/image";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apkoId = request.nextUrl.searchParams.get("apkoId");
    if (!apkoId) {
      return NextResponse.json({ error: "apkoId is required" }, { status: 400 });
    }

    const packages = await getAPKOPackages(apkoId);
    return NextResponse.json(packages, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Failed to fetch APKO packages:", error);
    return NextResponse.json({ error: "Failed to fetch APKO packages" }, { status: 500 });
  }
}
