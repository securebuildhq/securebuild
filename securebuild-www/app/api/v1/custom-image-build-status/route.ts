import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, validateFeatureFlag, FEATURE_FLAGS, createAuthErrorResponse } from '@/lib/auth/feature-flags';
import { getCustomImageBuildStatus } from '@/lib/custom-apko/custom-apko';

/**
 * GET /api/v1/custom-image-build-status?custom_image_apko_version_id=<id>
 * 
 * Gets the latest build status for a specific custom image APKO version.
 * Requires service account Bearer token authentication.
 * Only returns build status for configurations that belong to the authenticated team.
 * 
 * Query parameters:
 * - custom_image_apko_version_id: string (required)
 * 
 * Response:
 * {
 *   "id": "build-id",
 *   "custom_image_apko_version_id": "version-id", 
 *   "status": "queued" | "building" | "completed" | "failed",
 *   "created_at": "2024-01-01T00:00:00Z",
 *   "build_started_at": "2024-01-01T00:01:00Z",
 *   "build_finished_at": "2024-01-01T00:05:00Z",
 *   "builder_id": "vm-id",
 *   "apko_stdout": "build output",
 *   "apko_stderr": "build errors",
 *   "grype_aarch64_stderr": "grype aarch64 output", 
 *   "grype_x86_64_stderr": "grype x86_64 output",
 *   "worker_error": "error message"
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate request
    const authResult = await authenticateRequest(request);
    if ('success' in authResult && !authResult.success) {
      return createAuthErrorResponse(authResult);
    }

    const { teamId } = authResult as { teamId: string };

    // Check feature flag
    const featureCheck = await validateFeatureFlag(teamId, FEATURE_FLAGS.CUSTOM_APKO_UPLOAD);
    if (!featureCheck.success) {
      return createAuthErrorResponse(featureCheck);
    }

    // Get custom_image_apko_version_id from query parameters
    const { searchParams } = new URL(request.url);
    const customImageApkoVersionId = searchParams.get('custom_image_apko_version_id');

    if (!customImageApkoVersionId) {
      return NextResponse.json(
        { error: 'Missing custom_image_apko_version_id parameter' },
        { status: 400 }
      );
    }

    // Get the build status with team access control
    const buildStatus = await getCustomImageBuildStatus(customImageApkoVersionId, teamId);
    
    if (!buildStatus) {
      return NextResponse.json(
        { error: 'Build status not found or no builds exist for this APKO version' },
        { status: 404 }
      );
    }

    return NextResponse.json(buildStatus);

  } catch (error) {
    console.error('Error in custom-image-build-status GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}