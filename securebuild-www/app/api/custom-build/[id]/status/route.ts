import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, createAuthErrorResponse } from '@/lib/auth/feature-flags';
import {
  getCustomBuildRequest,
  getPackageVersionsByCustomBuildRequestId,
  getImageAPKOVersionsByCustomBuildRequestId,
  getExecutionsByPackageVersionId,
  getImageBuildsByApkoVersionId
} from '@/lib/custom-build/custom-build';

/**
 * GET /api/custom-build/[id]/status
 *
 * Returns the aggregated status of a custom build request.
 * Status is derived from the custom_build_request record and all associated builds.
 *
 * Response:
 * {
 *   build_request_id: string,
 *   status: "pending" | "building" | "success" | "failed",
 *   error?: string,  // Only present if status="failed" due to pre-build error
 *   created_at: string,
 *   builds: {
 *     packages: [{ id: string, status: string, created_at: string }],
 *     images: [{ id: string, status: string, created_at: string }]
 *   }
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    // 1. Await params (required in Next.js 15)
    const { id } = await params;

    // 2. Authenticate request
    const authResult = await authenticateRequest(request);
    if ('success' in authResult && !authResult.success) {
      return createAuthErrorResponse(authResult);
    }

    const { teamId } = authResult as { teamId: string };

    // 3. Fetch build request - returns 404 if not found or team doesn't have access
    const buildRequest = await getCustomBuildRequest(id, teamId);
    if (!buildRequest) {
      return NextResponse.json(
        { error: 'Build request not found' },
        { status: 404 }
      );
    }

    // 4. Query package_version and image_apko_version by custom_build_request_id
    const packageVersions = await getPackageVersionsByCustomBuildRequestId(id);
    const apkoVersions = await getImageAPKOVersionsByCustomBuildRequestId(id);

    // 4. Get executions for each package version
    const executions = [];
    for (const pkgVer of packageVersions) {
      const execs = await getExecutionsByPackageVersionId(pkgVer.id);
      executions.push(...execs);
    }

    // 5. Get image builds for each APKO version
    const imageBuilds = [];
    for (const apkoVer of apkoVersions) {
      const builds = await getImageBuildsByApkoVersionId(apkoVer.id);
      imageBuilds.push(...builds);
    }

    // 6. Determine overall status from builds
    let overallStatus: string;
    let overallError: string | null = null;

    if (buildRequest.status === 'pending') {
      // Builds not yet queued
      overallStatus = 'pending';
    } else if (buildRequest.status === 'failed') {
      // Pre-build error occurred
      overallStatus = 'failed';
      overallError = buildRequest.error;
    } else if (buildRequest.status === '') {
      // Aggregate status from builds
      if (executions.length === 0 && imageBuilds.length === 0) {
        // No builds exist yet (shouldn't happen if status is empty, but handle gracefully)
        overallStatus = 'pending';
      } else {
        const allStatuses = [
          ...executions.map(e => e.status),
          ...imageBuilds.map(ib => ib.status)
        ];

        if (allStatuses.some(s => s === 'failed')) {
          overallStatus = 'failed';
          overallError = null; // Error details come from individual builds
        } else if (imageBuilds.length > 0 && imageBuilds.every(ib => ib.status === 'success')) {
          // Only success when image builds exist and all are done
          overallStatus = 'success';
        } else {
          // Packages building, packages done but no images, or images building
          overallStatus = 'building';
        }
      }
    } else {
      // Unexpected status value
      overallStatus = 'unknown';
    }

    // 7. Build response
    const response = {
      build_request_id: id,
      status: overallStatus,
      ...(overallError && { error: overallError }),
      created_at: buildRequest.createdAt.toISOString(),
      builds: {
        packages: executions.map(e => ({
          id: e.id,
          status: e.status,
          created_at: e.createdAt.toISOString()
        })),
        images: imageBuilds.map(ib => ({
          id: ib.id,
          status: ib.status,
          created_at: ib.createdAt.toISOString()
        }))
      }
    };

    return NextResponse.json(response, { status: 200 });

  } catch (error) {
    console.error('Custom build status API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
