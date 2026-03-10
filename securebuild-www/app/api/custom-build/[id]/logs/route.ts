import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, createAuthErrorResponse } from '@/lib/auth/feature-flags';
import {
  getCustomBuildRequest,
  getPackageVersionsByCustomBuildRequestId,
  getImageAPKOVersionsByCustomBuildRequestId,
  getExecutionsByPackageVersionId,
  getImageBuildsByApkoVersionId,
  getPackageInfoForVersion,
  getImageInfoForApkoVersion
} from '@/lib/custom-build/custom-build';

/**
 * GET /api/custom-build/[id]/logs
 *
 * Returns build logs for a custom build request.
 * Includes logs from package builds (executions) and image builds.
 *
 * Response:
 * {
 *   build_request_id: string,
 *   logs: [
 *     {
 *       type: "package",
 *       execution_id: string,
 *       package_name: string,
 *       version: string,
 *       revision: number,
 *       status: string,
 *       x86_64: { build_stdout: string, build_stderr: string, status: string },
 *       aarch64: { build_stdout: string, build_stderr: string, status: string },
 *       timestamp: string
 *     },
 *     {
 *       type: "image",
 *       image_build_id: string,
 *       image_name: string,
 *       tags: string[],
 *       status: string,
 *       apko_stdout: string,
 *       apko_stderr: string,
 *       grype_x86_64_stderr: string,
 *       grype_aarch64_stderr: string,
 *       worker_error: string,
 *       timestamp: string
 *     }
 *   ]
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

    // 4. Collect logs from package versions and their executions
    const logs: any[] = [];

    for (const pkgVer of packageVersions) {
      // Get package info for this version
      const packageInfo = await getPackageInfoForVersion(pkgVer.id);

      if (packageInfo) {
        // Get executions for this package version
        const executions = await getExecutionsByPackageVersionId(pkgVer.id);

        for (const execution of executions) {
          logs.push({
            type: 'package',
            execution_id: execution.id,
            package_name: packageInfo.packageName,
            version: packageInfo.version,
            revision: packageInfo.apkRelease,
            status: execution.status,
            x86_64: {
              build_stdout: execution.x86_64BuildStdout,
              build_stderr: execution.x86_64BuildStderr,
              status: execution.x86_64Status
            },
            aarch64: {
              build_stdout: execution.aarch64BuildStdout,
              build_stderr: execution.aarch64BuildStderr,
              status: execution.aarch64Status
            },
            timestamp: execution.createdAt.toISOString()
          });
        }
      }
    }

    // 5. Collect logs from APKO versions and their image builds
    for (const apkoVer of apkoVersions) {
      // Get image info for this APKO version
      const imageInfo = await getImageInfoForApkoVersion(apkoVer.id);

      if (imageInfo) {
        // Get image builds for this APKO version
        const imageBuilds = await getImageBuildsByApkoVersionId(apkoVer.id);

        for (const imageBuild of imageBuilds) {
          logs.push({
            type: 'image',
            image_build_id: imageBuild.id,
            image_name: imageInfo.imageName,
            tags: imageInfo.tags,
            status: imageBuild.status,
            apko_stdout: imageBuild.apkoStdout,
            apko_stderr: imageBuild.apkoStderr,
            grype_x86_64_stderr: imageBuild.grypeX8664Stderr,
            grype_aarch64_stderr: imageBuild.grypeAarch64Stderr,
            worker_error: imageBuild.workerError,
            timestamp: imageBuild.createdAt.toISOString()
          });
        }
      }
    }

    // 8. Build response
    const response = {
      build_request_id: id,
      logs
    };

    return NextResponse.json(response, { status: 200 });

  } catch (error) {
    console.error('Custom build logs API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
