import { NextRequest, NextResponse } from 'next/server';
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
 * GET /api/v1/admin/teams
 * 
 * List all teams with their feature flags for admin management
 * Requires admin authentication
 * 
 * Query parameters:
 * - limit: number of teams to return (default: 50, max: 100)
 * - offset: number of teams to skip (default: 0)
 * - search: search teams by name (optional)
 */
export async function GET(request: NextRequest) {
  try {
    // Verify admin access
    const isAdmin = await verifyAdminAccess(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);
    const search = searchParams.get('search');

    const db = getDB(await getParam("DB_URI"));

    // Build query
    let query = `
      SELECT id, name, created_at, stripe_customer_id, payment_email, 
             registry_username, full_catalog_access, feature_flags,
             (SELECT COUNT(*) FROM service_account WHERE team_id = securebuild_team.id) as service_account_count
      FROM securebuild_team
    `;
    
    let countQuery = 'SELECT COUNT(*) FROM securebuild_team';
    const queryParams: unknown[] = [];
    let whereClause = '';

    // Add search filter if provided
    if (search && search.trim()) {
      whereClause = ' WHERE LOWER(name) LIKE LOWER($' + (queryParams.length + 1) + ')';
      queryParams.push(`%${search.trim()}%`);
    }

    query += whereClause;
    countQuery += whereClause;

    // Add ordering and pagination
    query += ' ORDER BY created_at DESC';
    query += ' LIMIT $' + (queryParams.length + 1) + ' OFFSET $' + (queryParams.length + 2);
    queryParams.push(limit, offset);

    // Execute queries
    const [teamsResult, countResult] = await Promise.all([
      db.query(query, queryParams),
      db.query(countQuery, queryParams.slice(0, -2)) // Remove limit/offset params for count
    ]);

    const teams = teamsResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      created_at: row.created_at,
      stripe_customer_id: row.stripe_customer_id,
      payment_email: row.payment_email,
      registry_username: row.registry_username,
      full_catalog_access: row.full_catalog_access,
      feature_flags: row.feature_flags || [],
      service_account_count: parseInt(row.service_account_count, 10)
    }));

    const totalCount = parseInt(countResult.rows[0].count, 10);

    return NextResponse.json({
      teams,
      pagination: {
        limit,
        offset,
        total: totalCount,
        has_more: offset + limit < totalCount
      }
    });
  } catch (error) {
    console.error('Error in admin teams list:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}