import { NextRequest, NextResponse } from 'next/server';
import { findServiceAccountWithValue } from '@/lib/team/service-account';
import { getDB } from '@/lib/data/db';
import { getParam } from '@/lib/data/param';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Authorization header required' },
        { status: 401 }
      );
    }

    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return NextResponse.json(
        { error: 'Invalid authorization header format. Expected: Bearer <token>' },
        { status: 401 }
      );
    }

    const token = tokenMatch[1];

    const authResult = await findServiceAccountWithValue(token);
    if (!authResult) {
      return NextResponse.json(
        { error: 'Invalid or expired service account token' },
        { status: 401 }
      );
    }

    if (!authResult.serviceAccount.isSystem) {
      return NextResponse.json(
        { error: 'This endpoint requires a system service account token.' },
        { status: 401 }
      );
    }

    const { id } = await params;

    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(
      `SELECT pv.id, pv.version, pv.apk_release, p.name as package_name, e.status, e.x86_64_status, e.aarch64_status
       FROM package_version pv
       INNER JOIN package p ON p.id = pv.package_id
       LEFT JOIN execution e ON e.package_version_id = pv.id
       WHERE pv.id = $1
       ORDER BY e.created_at DESC
       LIMIT 1`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { status: 'not_found', error: 'No package version with this ID' },
        { status: 404 }
      );
    }

    const row = result.rows[0];

    if (!row.status) {
      return NextResponse.json({
        status: 'pending',
        version: row.version,
        package_name: row.package_name,
        apk_release: row.apk_release,
      });
    }

    return NextResponse.json({
      status: row.status,
      version: row.version,
      package_name: row.package_name,
      apk_release: row.apk_release,
      x86_64_status: row.x86_64_status,
      aarch64_status: row.aarch64_status,
    });
  } catch (error) {
    console.error('Error retrieving package version:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve package version' },
      { status: 500 }
    );
  }
}
