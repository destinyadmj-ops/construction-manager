import { NextResponse } from 'next/server';
import { getDesktopReleaseInfo } from '@/server/desktop-release';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(
    { ok: true, release: getDesktopReleaseInfo() },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
