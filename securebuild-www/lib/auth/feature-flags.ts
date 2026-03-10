import { NextRequest, NextResponse } from 'next/server';
import { findServiceAccountWithValue } from '@/lib/team/service-account';
import { getDB } from '@/lib/data/db';
import { getParam } from '@/lib/data/param';

/**
 * Feature flag constants
 */
export const FEATURE_FLAGS = {
  CUSTOM_MELANGE_UPLOAD: 'custom-melange-upload',
  CUSTOM_APKO_UPLOAD: 'custom-apko-upload',
} as const;

export type FeatureFlagType = typeof FEATURE_FLAGS[keyof typeof FEATURE_FLAGS];

/**
 * Authentication result interface
 */
interface AuthenticationResult {
  teamId: string;
  serviceAccount: {
    id: string;
    name: string;
    partialValue: string;
    expiresAt: Date | null;
    expiresIn: string | null;
    lastUsedAt: Date | null;
    createdAt: Date;
  };
}

/**
 * Feature flag check result interface
 */
export interface FeatureFlagResult {
  success: true;
  teamId: string;
  serviceAccount: AuthenticationResult['serviceAccount'];
}

/**
 * Authentication/authorization error result
 */
export interface AuthError {
  success: false;
  error: string;
  status: 401 | 403;
}

/**
 * Check if a team has a specific feature flag enabled
 */
export async function checkTeamFeatureFlag(teamId: string, requiredFlag: FeatureFlagType): Promise<boolean> {
  try {
    const db = getDB(await getParam("DB_URI"));
    
    const query = 'SELECT feature_flags FROM securebuild_team WHERE id = $1';
    const result = await db.query(query, [teamId]);
    
    if (result.rows.length === 0) {
      return false;
    }
    
    const featureFlags: string[] = result.rows[0].feature_flags || [];
    return featureFlags.includes(requiredFlag);
  } catch (error) {
    console.error('Error checking team feature flag:', error);
    return false;
  }
}

/**
 * Authenticate a request using Bearer token
 */
export async function authenticateRequest(request: NextRequest): Promise<AuthenticationResult | AuthError> {
  try {
    // Check for Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return {
        success: false,
        error: 'Authorization header required',
        status: 401
      };
    }

    // Extract Bearer token
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return {
        success: false,
        error: 'Invalid authorization header format. Expected: Bearer <token>',
        status: 401
      };
    }

    const token = tokenMatch[1];

    // Authenticate the service account
    const authResult = await findServiceAccountWithValue(token);
    if (!authResult) {
      return {
        success: false,
        error: 'Invalid or expired service account token',
        status: 401
      };
    }

    return {
      teamId: authResult.teamId,
      serviceAccount: authResult.serviceAccount
    };
  } catch (error) {
    console.error('Error in authenticateRequest:', error);
    return {
      success: false,
      error: 'Internal server error',
      status: 401
    };
  }
}

/**
 * Validate that a team has the required feature flag
 */
export async function validateFeatureFlag(
  teamId: string,
  requiredFlag: FeatureFlagType
): Promise<{ success: true } | AuthError> {
  try {
    const hasFeature = await checkTeamFeatureFlag(teamId, requiredFlag);
    if (!hasFeature) {
      return {
        success: false,
        error: `Feature '${requiredFlag}' is not enabled for your team`,
        status: 403
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in validateFeatureFlag:', error);
    return {
      success: false,
      error: 'Internal server error',
      status: 403
    };
  }
}

/**
 * Convenience function that combines authentication and feature validation
 * @deprecated Use authenticateRequest and validateFeatureFlag separately for better separation of concerns
 */
export async function requireFeatureFlag(
  request: NextRequest,
  requiredFlag: FeatureFlagType
): Promise<FeatureFlagResult | AuthError> {
  const authResult = await authenticateRequest(request);
  if ('success' in authResult && !authResult.success) {
    return authResult;
  }

  const auth = authResult as AuthenticationResult;
  const featureResult = await validateFeatureFlag(auth.teamId, requiredFlag);
  if (!featureResult.success) {
    return featureResult;
  }

  return {
    success: true,
    teamId: auth.teamId,
    serviceAccount: auth.serviceAccount
  };
}

/**
 * Authenticate request without feature flag check (for existing APIs that don't need feature flags)
 */
export async function authenticateServiceAccount(request: NextRequest): Promise<AuthenticationResult | AuthError> {
  try {
    // Check for Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return {
        success: false,
        error: 'Authorization header required',
        status: 401
      };
    }

    // Extract Bearer token
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return {
        success: false,
        error: 'Invalid authorization header format. Expected: Bearer <token>',
        status: 401
      };
    }

    const token = tokenMatch[1];

    // Authenticate the service account
    const authResult = await findServiceAccountWithValue(token);
    if (!authResult) {
      return {
        success: false,
        error: 'Invalid or expired service account token',
        status: 401
      };
    }

    return {
      teamId: authResult.teamId,
      serviceAccount: authResult.serviceAccount
    };
  } catch (error) {
    console.error('Error in authenticateServiceAccount:', error);
    return {
      success: false,
      error: 'Internal server error',
      status: 401
    };
  }
}

/**
 * Helper to create consistent error responses
 */
export function createAuthErrorResponse(error: AuthError): NextResponse {
  return NextResponse.json(
    { error: error.error },
    { status: error.status }
  );
}

/**
 * Update team feature flags (for admin use)
 */
export async function updateTeamFeatureFlags(teamId: string, flags: FeatureFlagType[]): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDB(await getParam("DB_URI"));
    
    // Validate all flags are from allowed list
    const ALLOWED_FLAGS = Object.values(FEATURE_FLAGS);
    for (const flag of flags) {
      if (!ALLOWED_FLAGS.includes(flag)) {
        return { success: false, error: `Invalid flag: ${flag}` };
      }
    }
    
    const query = 'UPDATE securebuild_team SET feature_flags = $1 WHERE id = $2';
    await db.query(query, [flags, teamId]);
    
    return { success: true };
  } catch (error) {
    console.error('Error updating team feature flags:', error);
    return { success: false, error: 'Failed to update feature flags' };
  }
}

/**
 * Get team with feature flags (for admin use)
 */
export async function getTeamWithFeatureFlags(teamId: string) {
  try {
    const db = getDB(await getParam("DB_URI"));
    
    const query = `
      SELECT id, name, created_at, stripe_customer_id, payment_email, 
             registry_username, full_catalog_access, feature_flags
      FROM securebuild_team 
      WHERE id = $1
    `;
    
    const result = await db.query(query, [teamId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      created_at: row.created_at,
      stripe_customer_id: row.stripe_customer_id,
      payment_email: row.payment_email,
      registry_username: row.registry_username,
      full_catalog_access: row.full_catalog_access,
      feature_flags: row.feature_flags || []
    };
  } catch (error) {
    console.error('Error getting team with feature flags:', error);
    return null;
  }
}