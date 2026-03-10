import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, validateFeatureFlag, FEATURE_FLAGS, createAuthErrorResponse } from '@/lib/auth/feature-flags';
import { getCustomPackagesWithTeamInfo } from '@/lib/custom-packages/custom-package';

/**
 * GET /api/v1/custom-packages
 * 
 * Lists custom packages with team information for dashboard display
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
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

    // 3. Parse query parameters
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
    const search = url.searchParams.get('search') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const filterTeamId = url.searchParams.get('team_id') || undefined;
    const sortField = url.searchParams.get('sort_field') || 'created_at';
    const sortDirection = url.searchParams.get('sort_direction') === 'desc' ? 'DESC' : 'ASC';

    // 4. Get custom packages with pagination and filters
    const result = await getCustomPackagesWithTeamInfo({
      page,
      limit,
      search,
      status,
      teamId: filterTeamId,
      sortField: sortField as 'name' | 'created_at' | 'team' | 'status' | 'version',
      sortDirection: sortDirection as 'ASC' | 'DESC',
    });

    return NextResponse.json({
      success: true,
      packages: result.packages,
      totalCount: result.totalCount,
      page,
      limit
    });

  } catch (error) {
    console.error('Custom packages API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}