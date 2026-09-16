import { NextResponse } from 'next/server';
import { isHealthy } from '@/lib/health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Intentionally public. Only aggregate health is exposed to callers.
export async function GET() {
  const healthy = await isHealthy();
  return NextResponse.json(
    { status: healthy ? 'healthy' : 'unhealthy' },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
