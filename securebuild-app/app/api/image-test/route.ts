import { NextRequest, NextResponse } from "next/server";
import { getImageTest, createOrUpdateImageTest, deleteImageTest } from "@/lib/image/image-test";
import { getServerSession } from "@/lib/auth/server-session";
import { getSessionWithBearer } from "@/lib/auth/middleware/bearer-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/image-test?apko_id=xxx&apko_version_id=xxx
 *
 * Returns the test YAML for a specific APKO version
 */
export async function GET(request: NextRequest) {
  try {
    // Get and validate session (supports both bearer token and session cookie)
    const session = await getSessionWithBearer(request, getServerSession);
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized: Valid session or bearer token required" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const apkoId = searchParams.get("apko_id");
    const apkoVersionId = searchParams.get("apko_version_id");

    if (!apkoId || !apkoVersionId) {
      return NextResponse.json(
        { error: "Missing apko_id or apko_version_id" },
        { status: 400 }
      );
    }

    const testYaml = await getImageTest(apkoId, apkoVersionId);

    return NextResponse.json({
      testYaml: testYaml || null,
    });
  } catch (error) {
    console.error("Error fetching image test:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { error: `Failed to fetch image test: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/image-test
 *
 * Creates or updates a test YAML for a specific APKO version
 *
 * Body:
 * {
 *   apkoId: string,
 *   apkoVersionId: string,
 *   testYaml: string,
 *   description?: string
 * }
 */
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
    const { apkoId, apkoVersionId, testYaml, description } = body;

    if (!apkoId || !apkoVersionId) {
      return NextResponse.json(
        { error: "Missing apkoId or apkoVersionId" },
        { status: 400 }
      );
    }

    if (!testYaml || testYaml.trim() === "") {
      return NextResponse.json(
        { error: "Test YAML content cannot be empty" },
        { status: 400 }
      );
    }

    await createOrUpdateImageTest(apkoId, apkoVersionId, testYaml, description);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving image test:", error);
    return NextResponse.json(
      { error: "Failed to save image test" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/image-test
 *
 * Deletes the test YAML for a specific APKO version
 *
 * Body:
 * {
 *   apkoId: string,
 *   apkoVersionId: string
 * }
 */
export async function DELETE(request: NextRequest) {
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
    const { apkoId, apkoVersionId } = body;

    if (!apkoId || !apkoVersionId) {
      return NextResponse.json(
        { error: "Missing apkoId or apkoVersionId" },
        { status: 400 }
      );
    }

    await deleteImageTest(apkoId, apkoVersionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting image test:", error);
    return NextResponse.json(
      { error: "Failed to delete image test" },
      { status: 500 }
    );
  }
}
