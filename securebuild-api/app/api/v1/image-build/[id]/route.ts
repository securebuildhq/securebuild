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
      `SELECT ib.id, ib.status, ib.worker_error,
              ia.name as apko_name, ia.tags as apko_tags, i.name as image_name
       FROM image_build ib
       INNER JOIN image_apko_version iav ON iav.id = ib.image_apko_version_id
       INNER JOIN image_apko ia ON ia.id = iav.image_apko_id
       INNER JOIN image i ON i.id = ia.image_id
       WHERE ib.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { status: 'not_found', error: 'No image build with this ID' },
        { status: 404 }
      );
    }

    const row = result.rows[0];

    const response: any = {
      status: row.status,
      image_name: row.image_name,
      apko_name: row.apko_name,
      tags: row.apko_tags || [],
    };

    if (row.worker_error) {
      response.error = row.worker_error;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error retrieving image build:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve image build' },
      { status: 500 }
    );
  }
}
