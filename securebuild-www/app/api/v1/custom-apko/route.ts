import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, validateFeatureFlag, FEATURE_FLAGS, createAuthErrorResponse } from '@/lib/auth/feature-flags';
import { createCustomAPKO, getCustomAPKO, parseYAMLConfig, validateAPKOConfig } from '@/lib/custom-apko/custom-apko';
import { CustomAPKORequest } from '@/lib/types/apko';

/**
 * POST /api/v1/custom-apko
 * 
 * Submits a custom APKO configuration for image building.
 * Requires service account Bearer token authentication.
 * 
 * Request body:
 * {
 *   name: string,
 *   tags: string[],
 *   config: string (base64 encoded YAML),
 *   readme?: string,
 *   registry_urls: string[]
 * }
 */
export async function POST(request: NextRequest) {
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

    // Parse request body
    let body: CustomAPKORequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "name" field' },
        { status: 400 }
      );
    }


    if (!body.config || typeof body.config !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "config" field - must be base64 encoded YAML string' },
        { status: 400 }
      );
    }

    // Decode base64 config
    let decodedConfig: string;
    try {
      decodedConfig = Buffer.from(body.config, 'base64').toString('utf-8');
    } catch {
      return NextResponse.json(
        { error: 'Invalid base64 encoding in "config" field' },
        { status: 400 }
      );
    }

    // Validate registry_urls array
    if (!body.registry_urls || !Array.isArray(body.registry_urls)) {
      return NextResponse.json(
        { error: 'Missing or invalid "registry_urls" field - must be an array of strings' },
        { status: 400 }
      );
    }

    if (body.registry_urls.length === 0) {
      return NextResponse.json(
        { error: 'At least one registry URL is required' },
        { status: 400 }
      );
    }

    // Validate all registry URLs are strings with proper format
    for (const registryUrl of body.registry_urls) {
      if (typeof registryUrl !== 'string' || registryUrl.trim().length === 0) {
        return NextResponse.json(
          { error: 'All registry URLs must be non-empty strings' },
          { status: 400 }
        );
      }
      
      // Basic registry URL format validation (host/namespace format)
      const registryUrlPattern = /^[a-zA-Z0-9.-]+(:[0-9]+)?(\/[a-zA-Z0-9._-]+)*$/;
      if (!registryUrlPattern.test(registryUrl.trim())) {
        return NextResponse.json(
          { error: `Invalid registry URL format: ${registryUrl}. Expected format: host[:port][/namespace]` },
          { status: 400 }
        );
      }
    }

    // Validate tags array
    const tags = body.tags || [];
    if (!Array.isArray(tags)) {
      return NextResponse.json(
        { error: 'Tags must be an array of strings' },
        { status: 400 }
      );
    }

    // Validate all tags are strings
    for (const tag of tags) {
      if (typeof tag !== 'string' || tag.trim().length === 0) {
        return NextResponse.json(
          { error: 'All tags must be non-empty strings' },
          { status: 400 }
        );
      }
    }

    // Parse and validate APKO YAML configuration
    let apkoConfig;
    try {
      apkoConfig = parseYAMLConfig(decodedConfig);
    } catch (error) {
      return NextResponse.json(
        { error: `Invalid APKO YAML: ${error instanceof Error ? error.message : 'Unknown parsing error'}` },
        { status: 400 }
      );
    }

    // Validate the parsed APKO configuration
    const validation = validateAPKOConfig(apkoConfig);
    if (!validation.valid) {
      return NextResponse.json(
        { 
          error: 'Invalid APKO configuration',
          validation_errors: validation.errors 
        },
        { status: 400 }
      );
    }

    // Create the custom APKO configuration (store decoded YAML string)
    const result = await createCustomAPKO(
      teamId,
      body.name.trim(),
      tags.map(tag => tag.trim()),
      decodedConfig,
      body.readme?.trim(),
      body.registry_urls
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create custom APKO configuration' },
        { status: 400 }
      );
    }

    // Return success response
    return NextResponse.json(
      {
        success: true,
        message: 'Custom APKO configuration created successfully',
        custom_image_id: result.custom_image_id,
        custom_apko_id: result.custom_apko_id,
        custom_apko_version_id: result.custom_apko_version_id,
        name: body.name.trim(),
        tags: tags.map(tag => tag.trim())
      },
      { status: 201 }
    );

  } catch (error) {
    console.error('Error in custom-apko POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/custom-apko?custom_apko_id=<id>
 * 
 * Retrieves a custom APKO configuration by ID.
 * Requires service account Bearer token authentication.
 * Only returns configurations that belong to the authenticated team.
 * Returns config as base64 encoded YAML (same format as POST).
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

      // Get custom_apko_id from query parameters
    const { searchParams } = new URL(request.url);
    const customApkoId = searchParams.get('custom_apko_id');

    if (!customApkoId) {
      return NextResponse.json(
        { error: 'Missing custom_apko_id parameter' },
        { status: 400 }
      );
    }

    // Retrieve the APKO configuration with team access control
    const apkoConfig = await getCustomAPKO(customApkoId, teamId);
    
    if (!apkoConfig) {
      return NextResponse.json(
        { error: 'APKO configuration not found' },
        { status: 404 }
      );
    }

    // Base64 encode the YAML config to match POST request format
    const configBase64 = Buffer.from(apkoConfig.config, 'utf-8').toString('base64');

    return NextResponse.json({
      id: apkoConfig.id,
      name: apkoConfig.name,
      tags: apkoConfig.tags,
      config: configBase64,
      readme: apkoConfig.readme,
      created_at: apkoConfig.createdAt,
      updated_at: apkoConfig.updatedAt
    });

  } catch (error) {
    console.error('Error in custom-apko GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}