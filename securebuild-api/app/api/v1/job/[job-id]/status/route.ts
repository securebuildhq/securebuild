import { NextRequest, NextResponse } from 'next/server';
import { findServiceAccountWithValue } from '@/lib/team/service-account';
import { getWorkStatus } from '@/lib/utils/queue';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ 'job-id': string }> }
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

    const { 'job-id': jobId } = await params;

    const workStatus = await getWorkStatus(jobId);
    if (!workStatus) {
      return NextResponse.json(
        { status: 'expired', error: 'Job record does not exist (invalid job ID or older than 24 hours)' },
        { status: 404 }
      );
    }

    if (workStatus.status === 'failed') {
      return NextResponse.json({
        status: 'failed',
        error: workStatus.last_error,
      });
    }

    if (workStatus.status === 'completed') {
      const response: any = { status: 'completed' };
      if (workStatus.result && workStatus.result.package_version_id) {
        response.package_version_id = workStatus.result.package_version_id;
      }
      return NextResponse.json(response);
    }

    return NextResponse.json({
      status: workStatus.status,
    });
  } catch (error) {
    console.error('Error retrieving job status:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve job status' },
      { status: 500 }
    );
  }
}
