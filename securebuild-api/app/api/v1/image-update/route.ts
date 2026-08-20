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

    const { image_name, tag, image_tags } = body;

    if (!image_name || typeof image_name !== 'string') {
      return NextResponse.json(
        { error: 'image_name is required' },
        { status: 400 }
      );
    }

    if (!tag || typeof tag !== 'string') {
      return NextResponse.json(
        { error: 'tag is required' },
        { status: 400 }
      );
    }

    if (!semver.valid(tag) || semver.prerelease(tag) !== null) {
      return NextResponse.json(
        { error: `Tag '${tag}' is not a valid semantic version.` },
        { status: 400 }
      );
    }

    if (image_tags !== undefined &&
        (!Array.isArray(image_tags) || image_tags.some((imageTag) => typeof imageTag !== 'string' || imageTag.length === 0))) {
      return NextResponse.json(
        { error: 'image_tags must be an array of non-empty strings' },
        { status: 400 }
      );
    }

    const db = getDB(await getParam("DB_URI"));

    const imageResult = await db.query(
      `SELECT id, name, git_remote, apko_file_path, image_tag_template FROM image WHERE name = $1`,
      [image_name]
    );

    if (imageResult.rows.length === 0) {
      return NextResponse.json(
        { error: `Image '${image_name}' not found` },
        { status: 404 }
      );
    }

    const image = imageResult.rows[0];

    if (!image.git_remote) {
      return NextResponse.json(
        { error: `Image '${image_name}' is not linked to a git repository. This endpoint only supports git-linked images.` },
        { status: 400 }
      );
    }

    const jobId = await enqueueWork("image_update_check", {
      imageId: image.id,
      tag: tag,
      imageTags: image_tags ?? [],
    });

    return NextResponse.json(
      { job_id: jobId },
      { status: 202 }
    );
  } catch (error) {
    console.error('Error triggering image update:', error);
    return NextResponse.json(
      { error: 'Failed to trigger image update' },
      { status: 500 }
    );
  }
}
