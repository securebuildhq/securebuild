import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, validateFeatureFlag, FEATURE_FLAGS, createAuthErrorResponse } from '@/lib/auth/feature-flags';
import { 
  createCustomPackage, 
  createCustomPackageVersion, 
  createCustomPackageAdditionalFile 
} from '@/lib/custom-packages/custom-package';
import { 
  decompressBase64Content, 
  processVendorMelange, 
  validateMelangeStructure 
} from '@/lib/custom-packages/melange-processor';
import { checkAllNameConflicts } from '@/lib/custom-packages/validation';
import { VendorPackageRequest, CustomPackageResponse } from '@/lib/types/custom-package';
import { enqueueWork } from '@/lib/utils/queue';

/**
 * POST /api/v1/vendor/package
 * 
 * Submits a custom melange configuration for package building.
 * Requires service account Bearer token authentication.
 * 
 * Request body:
 * {
 *   melange_yaml: string (base64-encoded gzipped YAML),
 *   additional_files?: Array<{
 *     name: string,
 *     data: string (base64-encoded gzipped data)
 *   }>,
 *   use_root?: boolean
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

    // 2. Check feature flag
    const featureCheck = await validateFeatureFlag(teamId, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);
    if (!featureCheck.success) {
      return createAuthErrorResponse(featureCheck);
    }

    // 3. Parse request body
    let body: VendorPackageRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // 4. Validate required fields
    if (!body.melange_yaml || typeof body.melange_yaml !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid "melange_yaml" field - must be base64-encoded gzipped YAML string' },
        { status: 400 }
      );
    }

    // 5. Decompress and decode melange YAML
    let melangeYamlContent: string;
    try {
      melangeYamlContent = decompressBase64Content(body.melange_yaml);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: `Failed to decompress melange YAML: ${error instanceof Error ? error.message : 'Unknown error'}` },
        { status: 400 }
      );
    }

    // 6. Process melange configuration
    let processedMelange;
    try {
      processedMelange = processVendorMelange(melangeYamlContent);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: `Invalid melange configuration: ${error instanceof Error ? error.message : 'Unknown error'}` },
        { status: 400 }
      );
    }

    // 7. Validate melange structure
    let parsedConfig;
    try {
      const yaml = await import('js-yaml');
      parsedConfig = yaml.load(melangeYamlContent);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: `Failed to parse YAML for structure validation: ${error instanceof Error ? error.message : 'Unknown error'}` },
        { status: 400 }
      );
    }
    
    const structureErrors = validateMelangeStructure(parsedConfig);
    if (structureErrors.length > 0) {
      return NextResponse.json(
        { success: false, error: `Melange structure validation failed: ${structureErrors.join(', ')}` },
        { status: 400 }
      );
    }

    // 8. Check for package name conflicts
    const conflictingNames = await checkAllNameConflicts(processedMelange.allNames, teamId);
    if (conflictingNames.length > 0) {
      const conflictMessages = conflictingNames.map(conflict => 
        `Package name "${conflict.name}" already owned by ${conflict.table === 'package' ? 'system' : `team ${conflict.team_id}`}`
      ).join(', ');
      
      return NextResponse.json(
        { success: false, error: `Package name conflicts: ${conflictMessages}` },
        { status: 409 }
      );
    }

    // 9. Process additional files if provided
    const additionalFiles: Array<{ name: string, content: string }> = [];
    if (body.additional_files && Array.isArray(body.additional_files)) {
      for (const file of body.additional_files) {
        if (!file.name || typeof file.name !== 'string') {
          return NextResponse.json(
            { success: false, error: 'Each additional file must have a "name" field' },
            { status: 400 }
          );
        }
        
        if (!file.data || typeof file.data !== 'string') {
          return NextResponse.json(
            { success: false, error: `Additional file "${file.name}" must have a "data" field with base64-encoded gzipped content` },
            { status: 400 }
          );
        }
        
        try {
          const decompressedContent = decompressBase64Content(file.data);
          additionalFiles.push({
            name: file.name,
            content: decompressedContent
          });
        } catch (error) {
          return NextResponse.json(
            { success: false, error: `Failed to decompress additional file "${file.name}": ${error instanceof Error ? error.message : 'Unknown error'}` },
            { status: 400 }
          );
        }
      }
    }

    // 10. Create custom package and version records
    let customPackageId: string;
    let customPackageVersionId: string;
    let buildId: string;

    try {
      // Create main custom package
      customPackageId = await createCustomPackage(
        processedMelange.packageName,
        teamId
      );

      // Create subpackages if they exist
      const subpackageIds: string[] = [];
      if (processedMelange.subpackages && processedMelange.subpackages.length > 0) {
        for (const subpackageName of processedMelange.subpackages) {
          const subpackageId = await createCustomPackage(
            subpackageName,
            teamId,
            customPackageId // parent_id
          );
          subpackageIds.push(subpackageId);
        }
      }

      // Create custom package version
      customPackageVersionId = await createCustomPackageVersion(
        customPackageId,
        processedMelange.version,
        processedMelange.yaml,
        undefined, // license will be extracted from melange YAML during build
        body.use_root || false,
      );

      // Add additional files
      for (const file of additionalFiles) {
        await createCustomPackageAdditionalFile(
          customPackageVersionId,
          file.name,
          file.content
        );
      }

      // Queue for processing
      buildId = await enqueueWork('build_custom_package', {
        customPackageId: customPackageId,
        customPackageVersionId: customPackageVersionId,
        packageName: processedMelange.packageName,
        version: processedMelange.version,
        apkRelease: 1, // Default APK release number
        cause: "vendor submission",
        causeId: teamId
      });

    } catch (error) {
      console.error('Failed to create custom package:', error);
      
      // Check if this is a validation error (package name conflicts)
      if (error instanceof Error && error.message.includes('already exists')) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 400 }
        );
      }
      
      // Other errors are server errors
      return NextResponse.json(
        { success: false, error: `Failed to create custom package: ${error instanceof Error ? error.message : 'Unknown error'}` },
        { status: 500 }
      );
    }

    // 11. Return success response
    const response: CustomPackageResponse = {
      success: true,
      package_id: customPackageId,
      package_version_id: customPackageVersionId,
      package_name: processedMelange.packageName,
      build_id: buildId,
      status: "queued"
    };

    return NextResponse.json(response, { status: 201 });

  } catch (error) {
    console.error('Vendor package API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/vendor/package
 * 
 * Lists all custom packages for the authenticated team
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

    // 3. Get custom packages for the team
    const { getCustomPackages } = await import('@/lib/custom-packages/custom-package');
    const packages = await getCustomPackages(teamId);

    return NextResponse.json({
      success: true,
      packages
    });

  } catch (error) {
    console.error('List vendor packages API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
