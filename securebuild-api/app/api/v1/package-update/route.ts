import { NextRequest, NextResponse } from 'next/server';
import { findServiceAccountWithValue } from '@/lib/team/service-account';
import { getDB } from '@/lib/data/db';
import { getParam } from '@/lib/data/param';
import { enqueueWork } from '@/lib/utils/queue';
import semver from 'semver';

export async function POST(request: NextRequest) {
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

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { package_family_name, tag } = body;

    if (!package_family_name || typeof package_family_name !== 'string') {
      return NextResponse.json(
        { error: 'package_family_name is required' },
        { status: 400 }
      );
    }

    if (!tag || typeof tag !== 'string') {
      return NextResponse.json(
        { error: 'tag is required' },
        { status: 400 }
      );
    }

    if (!semver.valid(tag)) {
      return NextResponse.json(
        { error: `Tag '${tag}' is not a valid semantic version.` },
        { status: 400 }
      );
    }

    const db = getDB(await getParam("DB_URI"));

    const familyResult = await db.query(
      `SELECT id, name, git_remote, melange_file_path, initial_tag FROM package_family WHERE name = $1`,
      [package_family_name]
    );

    if (familyResult.rows.length === 0) {
      return NextResponse.json(
        { error: `Package family '${package_family_name}' not found` },
        { status: 404 }
      );
    }

    const family = familyResult.rows[0];

    if (!family.git_remote) {
      return NextResponse.json(
        { error: `Package family '${package_family_name}' is not linked to a git repository. This endpoint only supports git-linked package families.` },
        { status: 400 }
      );
    }

    const jobId = await enqueueWork("package_family_update_check", {
      packageFamilyId: family.id,
      tag: tag,
      force: true, // scheduled checks will be disabled if this package will be built on demand. "force" bypassed the disabled flag.
      skip_image_creation: true, // image builds are triggered separately via the image-update API
    });

    return NextResponse.json(
      { job_id: jobId },
      { status: 202 }
    );
  } catch (error) {
    console.error('Error triggering package update:', error);
    return NextResponse.json(
      { error: 'Failed to trigger package update' },
      { status: 500 }
    );
  }
}
