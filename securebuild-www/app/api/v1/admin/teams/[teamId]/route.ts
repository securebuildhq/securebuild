import { NextRequest, NextResponse } from 'next/server';
import { getTeamWithFeatureFlags, updateTeamFeatureFlags, FEATURE_FLAGS, FeatureFlagType } from '@/lib/auth/feature-flags';
import { getDB } from '@/lib/data/db';
import { getParam } from '@/lib/data/param';

/**
 * Verify admin access (placeholder - implement proper admin authentication)
 * TODO: Integrate with actual admin authentication system
 */
async function verifyAdminAccess(request: NextRequest): Promise<boolean> {
  // For now, check for a special admin token
  // In production, this should integrate with your admin authentication system
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return false;
  }

  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return false;
  }

  const token = tokenMatch[1];
  
  // Check if it's the admin token from environment
  // This is a simple implementation - replace with proper admin auth
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    // If no admin token is configured, deny access
    return false;
  }
  
  return token === adminToken;
}

/**
 * Get admin user ID from request (placeholder)
 * TODO: Extract actual admin user info from authentication
 */
function getAdminId(/* _request: NextRequest */): string {
  // Placeholder - in production this should extract from JWT or session
  return 'admin-user';
}

/**
 * Log admin activity (placeholder)
 * TODO: Implement proper activity logging
 */
async function logActivity(activity: {
  type: string;
  teamId: string;
  adminId: string;
  changes: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    
    // Simple activity logging - in production you might want a dedicated audit table
    await db.query(
      'INSERT INTO activity_log (type, team_id, admin_id, changes, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [activity.type, activity.teamId, activity.adminId, JSON.stringify(activity.changes)]
    );
  } catch (error) {
    console.error('Failed to log admin activity:', error);
    // Don't throw - logging failure shouldn't break the operation
  }
}

/**
 * GET /api/v1/admin/teams/[teamId]
 * 
 * Get team details with feature flags for admin management
 * Requires admin authentication
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    // Verify admin access
    const isAdmin = await verifyAdminAccess(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const { teamId } = await params;

    // Get team with feature flags
    const team = await getTeamWithFeatureFlags(teamId);
    if (!team) {
      return NextResponse.json(
        { error: 'Team not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(team);
  } catch (error) {
    console.error('Error in admin teams GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/v1/admin/teams/[teamId]
 * 
 * Update team feature flags
 * Requires admin authentication
 * 
 * Request body:
 * {
 *   "feature_flags": ["custom_melange_upload", "custom_apko_upload"]
 * }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    // Verify admin access
    const isAdmin = await verifyAdminAccess(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const { teamId } = await params;

    // Parse request body
    let body: { feature_flags: string[] };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    if (!body.feature_flags || !Array.isArray(body.feature_flags)) {
      return NextResponse.json(
        { error: 'Missing or invalid "feature_flags" field - must be an array' },
        { status: 400 }
      );
    }

    // Validate flags are from allowed list
    const ALLOWED_FLAGS = Object.values(FEATURE_FLAGS) as string[];
    for (const flag of body.feature_flags) {
      if (!ALLOWED_FLAGS.includes(flag)) {
        return NextResponse.json(
          { error: `Invalid flag: ${flag}. Allowed flags: ${ALLOWED_FLAGS.join(', ')}` },
          { status: 400 }
        );
      }
    }

    // Update feature flags
    const result = await updateTeamFeatureFlags(teamId, body.feature_flags as FeatureFlagType[]);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to update feature flags' },
        { status: 400 }
      );
    }

    // Log the change for audit
    // TODO: this doesn't work
    // await logActivity({
    //   type: 'FEATURE_FLAGS_UPDATED',
    //   teamId,
    //   adminId: getAdminId(),
    //   changes: { feature_flags: body.feature_flags }
    // });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in admin teams PATCH:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}