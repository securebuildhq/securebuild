import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureFlag, FEATURE_FLAGS, createAuthErrorResponse } from '@/lib/auth/feature-flags';
import { createCustomExternalRegistry, getCustomExternalRegistries, deleteCustomExternalRegistry } from '@/lib/custom-apko/custom-external-registry';

/**
 * POST /api/v1/custom-external-registry
 * 
 * Creates a new custom external registry for the authenticated team.
 * Requires service account Bearer token authentication.
 * 
 * Request body:
 * {
 *   host: string,
 *   username: string,
 *   password: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication and feature flag
    const authCheck = await requireFeatureFlag(request, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);
    if (!authCheck.success) {
      return createAuthErrorResponse(authCheck);
    }

    const { teamId } = authCheck;

    // Parse request body
    let body: {
      host: string;
      username: string;
      password: string;
    };
    
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!body.host || typeof body.host !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "host" field' },
        { status: 400 }
      );
    }

    if (!body.username || typeof body.username !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "username" field' },
        { status: 400 }
      );
    }

    if (!body.password || typeof body.password !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "password" field' },
        { status: 400 }
      );
    }

    // Validate host format (DNS name or IP with optional port)
    const hostPattern = /^([a-zA-Z0-9.-]+|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:[0-9]+)?$/;
    if (!hostPattern.test(body.host)) {
      return NextResponse.json(
        { error: 'Invalid host format. Must be a DNS name, IP address, or either with optional ":port" suffix' },
        { status: 400 }
      );
    }

    // Validate registry by checking /v2/ endpoint
    try {
      const registryUrl = `https://${body.host}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(`${registryUrl}/v2/`, {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Registry should respond with 200, 401, or 403 for valid /v2/ endpoint
      if (![200, 401, 403].includes(response.status)) {
        return NextResponse.json(
          { error: `Registry validation failed: ${body.host} does not appear to be a valid container registry` },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: `Registry validation failed: Unable to connect to ${body.host}` },
        { status: 400 }
      );
    }

    // Create the custom external registry
    const result = await createCustomExternalRegistry(
      teamId,
      body.host,
      body.username,
      body.password
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create custom external registry' },
        { status: 400 }
      );
    }

    // Return success response
    return NextResponse.json(
      {
        success: true,
        message: 'Custom external registry created successfully',
        registry_id: result.registry_id
      },
      { status: 201 }
    );

  } catch (error) {
    console.error('Error in custom-external-registry POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/custom-external-registry
 * 
 * Retrieves custom external registries for the authenticated team.
 * Requires service account Bearer token authentication.
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication and feature flag
    const authCheck = await requireFeatureFlag(request, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);
    if (!authCheck.success) {
      return createAuthErrorResponse(authCheck);
    }

    // Retrieve the external registries for the team
    const registries = await getCustomExternalRegistries(authCheck.teamId);
    
    return NextResponse.json({
      registries
    });

  } catch (error) {
    console.error('Error in custom-external-registry GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/v1/custom-external-registry?registry_id=<id>
 * 
 * Deletes a custom external registry.
 * Requires service account Bearer token authentication.
 * Only allows deletion of registries that belong to the authenticated team.
 */
export async function DELETE(request: NextRequest) {
  try {
    // Check authentication and feature flag
    const authCheck = await requireFeatureFlag(request, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);
    if (!authCheck.success) {
      return createAuthErrorResponse(authCheck);
    }

    // Get registry_id from query parameters
    const { searchParams } = new URL(request.url);
    const registryId = searchParams.get('registry_id');

    if (!registryId) {
      return NextResponse.json(
        { error: 'Missing registry_id parameter' },
        { status: 400 }
      );
    }

    // Delete the external registry with team access control
    const result = await deleteCustomExternalRegistry(registryId, authCheck.teamId);
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to delete custom external registry' },
        { status: result.error === 'Registry not found' ? 404 : 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Custom external registry deleted successfully'
    });

  } catch (error) {
    console.error('Error in custom-external-registry DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}