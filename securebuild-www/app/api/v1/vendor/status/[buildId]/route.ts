import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, validateFeatureFlag, FEATURE_FLAGS, createAuthErrorResponse } from '@/lib/auth/feature-flags';

/**
 * GET /api/v1/vendor/status/[buildId]
 * 
 * Checks the build status of a custom package build.
 * Requires service account Bearer token authentication.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ buildId: string }> }
): Promise<NextResponse> {
  try {
    // 1. Authenticate request
    const authResult = await authenticateRequest(request);
    if ('success' in authResult && !authResult.success) {
      return createAuthErrorResponse(authResult);
    }

    const { teamId } = authResult as { teamId: string };

    // 2. Check feature flag
    const featureCheck = await validateFeatureFlag(teamId, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);
    if (!featureCheck.success) {
      return createAuthErrorResponse(featureCheck);
    }

    // 3. Validate buildId parameter
    const { buildId } = await params;
    if (!buildId || typeof buildId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid build ID' },
        { status: 400 }
      );
    }

    // 4. Get build status from work queue
    // This uses the same queue system as custom APKO builds
    const { getWorkStatus } = await import('@/lib/utils/queue');
    
    try {
      const buildStatus = await getWorkStatus(buildId);
      
      if (!buildStatus) {
        return NextResponse.json(
          { success: false, error: 'Build not found' },
          { status: 404 }
        );
      }

      // Verify build belongs to the authenticated team
      if (buildStatus.metadata?.team_id !== teamId) {
        return NextResponse.json(
          { success: false, error: 'Build not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        build_id: buildId,
        status: buildStatus.status,
        created_at: buildStatus.created_at,
        updated_at: buildStatus.updated_at,
        error: buildStatus.error || undefined,
        metadata: buildStatus.metadata
      });

    } catch (error) {
      console.error('Failed to get build status:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve build status' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Vendor status API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}