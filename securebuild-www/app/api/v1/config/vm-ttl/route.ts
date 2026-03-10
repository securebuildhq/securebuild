import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/data/db';
import { getParam } from '@/lib/data/param';
import parse from 'parse-duration';

/**
 * Verify admin access
 */
async function verifyAdminAccess(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return false;
  }

  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return false;
  }

  const token = tokenMatch[1];

  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return false;
  }

  return token === adminToken;
}

/**
 * Helper function to validate Go duration format using parse-duration
 */
function isValidDuration(duration: string): boolean {
  try {
    const d = parse(duration);
    return d !== null && d > 0;
  } catch {
    return false;
  }
}

/**
 * GET /api/v1/config/vm-ttl
 *
 * Get the current VM TTL configuration as duration string
 * Requires admin authentication
 */
export async function GET(request: NextRequest) {
  try {
    const isAdmin = await verifyAdminAccess(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(
      'SELECT value FROM dynamic_config WHERE key = $1',
      ['vm_ttl_duration']
    );

    const vmTTLDuration = result.rows.length > 0 && result.rows[0].value 
      ? result.rows[0].value 
      : "24h"; // Default

    return NextResponse.json({ vmTTLDuration });
  } catch (error) {
    console.error('Error getting VM TTL:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/v1/config/vm-ttl
 *
 * Update the VM TTL configuration with duration string
 * Requires admin authentication
 *
 * Request body:
 * - vmTTLDuration: string (Go duration format, e.g., "24h", "2h30m", "45m")
 */
export async function PUT(request: NextRequest) {
  try {
    const isAdmin = await verifyAdminAccess(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { vmTTLDuration } = body;

    // Validate input
    if (!vmTTLDuration || typeof vmTTLDuration !== 'string') {
      return NextResponse.json(
        { error: 'vmTTLDuration must be a valid string' },
        { status: 400 }
      );
    }

    if (!isValidDuration(vmTTLDuration)) {
      return NextResponse.json(
        { error: 'vmTTLDuration must be in Go duration format (e.g., "24h", "2h30m", "45m")' },
        { status: 400 }
      );
    }

    const db = getDB(await getParam("DB_URI"));

    // Use UPSERT to insert or update the value
    await db.query(
      `INSERT INTO dynamic_config (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value`,
      ['vm_ttl_duration', vmTTLDuration]
    );

    return NextResponse.json({
      success: true,
      vmTTLDuration
    });
  } catch (error) {
    console.error('Error updating VM TTL:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
