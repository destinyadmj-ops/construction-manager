import { NextResponse } from 'next/server';
import { getAppVersionInfo } from '@/server/version';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ ok: true, info: getAppVersionInfo() });
}
