import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, createAuthErrorResponse } from '@/lib/auth/feature-flags';
import { createCustomBuildRequest, updateCustomBuildRequestError, checkTeamCustomBuildImagePermission } from '@/lib/custom-build/custom-build';
import { validateBuildRequest } from '@/lib/custom-build/validation';
import {
  findPackagesForImage,
  createPackageVersionForCustomBuild,
  createImageAPKOVersionForCustomBuild,
  createImageAPKO,
  determineVersionChangeType,
  VersionChangeType,
  getNextApkRelease,
  findOrCreatePackage,
  generateNewPackageName,
  findBestBasisPackage
} from '@/lib/custom-build/package-image-manager';
import { updateMelangeVersion, updateAPKOForCustomBuild } from '@/lib/custom-build/version-manager';
import { enqueueWork } from '@/lib/utils/queue';

/**
 * POST /api/custom-image/build
 *
 * Triggers a custom build for an image with a specific tag and commit SHA.
 * Creates package_version and image_apko_version records synchronously,
 * then queues async build processing.
 *
 * Request body:
 * {
 *   image_name: string,  // required - name of the image (e.g., "kotsadm")
 *   tag: string,         // required - version tag (e.g., "v1.128.0")
 *   commit_sha: string   // required - git commit SHA for reproducible builds
 * }
 *
 * Response:
 * {
 *   build_request_id: string
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Authenticate request
    const authResult = await authenticateRequest(request);
    if ('success' in authResult && !authResult.success) {
      return createAuthErrorResponse(authResult);
    }

    const { teamId } = authResult as { teamId: string };

    // 2. Parse and validate request body
    let body: {
      image_name?: string;
      tag?: string;
      commit_sha?: string;
    };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const validation = validateBuildRequest(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: `Validation failed: ${validation.errors.join(', ')}` },
        { status: 400 }
      );
    }

    const { image_name, tag, commit_sha } = body as {
      image_name: string;
      tag: string;
      commit_sha: string;
    };

    // 3. Check if team has permission to build this image (check permission first to avoid leaking image names)
    const hasPermission = await checkTeamCustomBuildImagePermission(teamId, image_name);
    if (!hasPermission) {
      return NextResponse.json(
        { error: `Team does not have permission to build image '${image_name}'. Please contact your administrator to configure custom build access for this image.` },
        { status: 403 }
      );
    }

    // 4. Find packages for this image by analyzing APKO configuration
    // This validates that the image exists and returns the APKO data along with packages
    const result = await findPackagesForImage(image_name, tag);
    if (!result) {
      return NextResponse.json(
        { error: `No APKO configuration or packages found for image '${image_name}' with tag '${tag}'` },
        { status: 404 }
      );
    }

    const { packages: packagesInfo, apkoData } = result;
    console.log('Found packages and APKO for image:', {
      imageName: image_name,
      packageCount: packagesInfo.length,
      apkoId: apkoData.apkoId
    });

    // 5. Validate that all packages have initial versions before creating build request
    for (const pkgInfo of packagesInfo) {
      if (!pkgInfo.latestPackageVersion) {
        return NextResponse.json(
          { error: `No package version found for package '${pkgInfo.packageName}'. Please create an initial version first.` },
          { status: 400 }
        );
      }
    }

    // 6. Create build request record (only after validation)
    const buildRequestId = await createCustomBuildRequest(
      teamId,
      image_name,
      tag,
      commit_sha
    );

    // 7. SYNCHRONOUSLY create melange and APKO version records
    try {
      // Track old and new package names for APKO update
      const oldPackageNames: string[] = [];
      const newPackageNames: string[] = [];

      // Create package_version records for all packages
      for (const pkgInfo of packagesInfo) {
        const latestPackageVersion = pkgInfo.latestPackageVersion!; // Safe after validation

        // Determine version change type to decide package name and epoch behavior
        const changeType = determineVersionChangeType(latestPackageVersion.version, tag);

        let targetPackageId: string;
        let targetPackageName: string;
        let targetVersion: string;
        let targetEpoch: number;

        switch (changeType) {
          case VersionChangeType.SAME:
            // Same version: same package, increment epoch
            targetPackageId = pkgInfo.packageId;
            targetPackageName = pkgInfo.packageName;
            targetVersion = tag;
            targetEpoch = await getNextApkRelease(pkgInfo.packageId, tag);
            break;

          case VersionChangeType.PATCH:
            // Patch version change: same package name, new version, reset epoch
            targetPackageId = pkgInfo.packageId;
            targetPackageName = pkgInfo.packageName;
            targetVersion = tag;
            targetEpoch = await getNextApkRelease(pkgInfo.packageId, tag);
            break;

          case VersionChangeType.MINOR_OR_MAJOR:
            // Minor/major version change: new package name based on new version
            const newPackageName = generateNewPackageName(pkgInfo.packageName, tag);

            // Find or create the new package
            const newPackage = await findOrCreatePackage(newPackageName);
            targetPackageId = newPackage.id;
            targetPackageName = newPackage.name;
            targetVersion = tag;
            targetEpoch = await getNextApkRelease(newPackage.id, tag);
            break;
        }

        // Track package name changes for APKO update
        oldPackageNames.push(pkgInfo.originalPackageName); // Use original name from APKO
        newPackageNames.push(targetPackageName);

        // Update melange YAML with target package name, version, epoch, and commit SHA
        const updatedMelangeYaml = updateMelangeVersion(
          latestPackageVersion.melangeYaml,
          targetPackageName,
          targetVersion,
          targetEpoch,
          commit_sha
        );

        // Create new package_version record with custom_build_request_id
        await createPackageVersionForCustomBuild(
          targetPackageId,
          targetVersion,
          updatedMelangeYaml,
          buildRequestId,
          targetEpoch,
          latestPackageVersion.useRoot
        );
      }

      // Update APKO YAML with new package names and version
      const updatedApkoYaml = updateAPKOForCustomBuild(
        apkoData.apkoYaml,
        oldPackageNames,
        newPackageNames,
        tag
      );

      // Check if the requested tag already exists in the image_apko tags
      const tagExists = apkoData.tags.includes(tag);
      let targetApkoId: string;

      if (tagExists) {
        // Tag exists: create new image_apko_version for existing image_apko
        targetApkoId = apkoData.apkoId;
      } else {
        // Tag doesn't exist: create new image_apko with the new tag
        targetApkoId = await createImageAPKO(apkoData.imageId, [tag]);
      }

      // Create new image_apko_version record with custom_build_request_id
      const apkoVersionId = await createImageAPKOVersionForCustomBuild(
        targetApkoId,
        updatedApkoYaml,
        buildRequestId
      );

      // Log successful version creation
      console.log('Created package versions and APKO version:', {
        buildRequestId,
        packageCount: packagesInfo.length,
        apkoVersionId,
        imageName: image_name,
        tag,
        commitSha: commit_sha
      });

    } catch (error) {
      // If config generation fails, mark request as failed and return error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to create build versions:', error);

      await updateCustomBuildRequestError(buildRequestId, 'failed', errorMessage);

      return NextResponse.json(
        {
          build_request_id: buildRequestId,
          error: errorMessage
        },
        { status: 500 }
      );
    }

    // 7. ASYNCHRONOUSLY queue the actual builds
    try {
      await enqueueWork('custom_build_request', {
        build_request_id: buildRequestId
      });
    } catch (error) {
      console.error('Failed to enqueue custom build request:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to queue build';

      await updateCustomBuildRequestError(buildRequestId, 'failed', errorMessage);

      return NextResponse.json(
        {
          build_request_id: buildRequestId,
          error: errorMessage
        },
        { status: 500 }
      );
    }

    // 8. Return success response with build request ID
    return NextResponse.json(
      {
        build_request_id: buildRequestId
      },
      { status: 201 }
    );

  } catch (error) {
    console.error('Custom build API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
