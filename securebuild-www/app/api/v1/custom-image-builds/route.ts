import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, validateFeatureFlag, FEATURE_FLAGS, createAuthErrorResponse } from '@/lib/auth/feature-flags';
import { listCustomImageBuilds } from '@/lib/custom-apko/custom-apko';

/**
 * GET /api/v1/custom-image-builds?custom_image_id=<id>&page=1&limit=10
 * 
 * Lists all builds for a specific custom image with pagination.
 * Requires service account Bearer token authentication.
 * Only returns builds for images that belong to the authenticated team.
 * 
 * Query parameters:
 * - custom_image_id: string (required)
 * - page: number (optional, default: 1)
 * - limit: number (optional, default: 10, max: 100)
 * 
 * Response:
 * {
 *   "builds": [
 *     {
 *       "id": "build-id",
 *       "custom_image_apko_version_id": "version-id",
 *       "status": "queued" | "building" | "completed" | "failed",
 *       "created_at": "2024-01-01T00:00:00Z",
 *       "build_started_at": "2024-01-01T00:01:00Z",
 *       "build_finished_at": "2024-01-01T00:05:00Z",
 *       "builder_id": "vm-id",
 *       "apko_stdout": "build output",
 *       "apko_stderr": "build errors",
 *       "grype_aarch64_stderr": "grype scan errors for aarch64",
 *       "grype_x86_64_stderr": "grype scan errors for x86_64",
 *       "builder_stdout": "builder output",
 *       "worker_error": "error message"
 *     }
 *   ],
 *   "total": 25,
 *   "page": 1,
 *   "limit": 10,
 *   "totalPages": 3
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

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const customImageId = searchParams.get('custom_image_id');
    const pageParam = searchParams.get('page');
    const limitParam = searchParams.get('limit');

    if (!customImageId) {
      return NextResponse.json(
        { error: 'Missing custom_image_id parameter' },
        { status: 400 }
      );
    }

    // Parse pagination parameters
    let page = 1;
    let limit = 10;

    if (pageParam) {
      const parsedPage = parseInt(pageParam, 10);
      if (isNaN(parsedPage) || parsedPage < 1) {
        return NextResponse.json(
          { error: 'Invalid page parameter - must be a positive integer' },
          { status: 400 }
        );
      }
      page = parsedPage;
    }

    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        return NextResponse.json(
          { error: 'Invalid limit parameter - must be between 1 and 100' },
          { status: 400 }
        );
      }
      limit = parsedLimit;
    }

    // Get the builds with team access control and pagination
    const result = await listCustomImageBuilds(customImageId, teamId, page, limit);

    return NextResponse.json(result);

  } catch (error) {
    console.error('Error in custom-image-builds GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}