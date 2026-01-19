import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  getCookieName,
  isEditModeConfigured,
  issueEditCookieValue,
  validateEditCookieValue,
} from '@/server/auth/edit-mode';

export const runtime = 'nodejs';

export async function GET() {
  const c = await cookies();
  const value = c.get(getCookieName())?.value;
  const configured = isEditModeConfigured();
  const enabled = configured ? validateEditCookieValue(value) : true;
  return NextResponse.json({ ok: true, configured, enabled });
}

export async function POST(request: Request) {
  const configured = isEditModeConfigured();
  if (!configured) {
    // In dev / early setup, allow enabling without a password.
    return NextResponse.json({ ok: true, enabled: true, configured: false });
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === 'string' ? body.password : '';
  const expected = (process.env.MASTER_HUB_EDIT_PASSWORD ?? '').trim();
  if (!expected || password !== expected) {
    return NextResponse.json({ ok: false, error: 'パスワードが違います' }, { status: 401 });
  }

  const value = issueEditCookieValue();
  if (!value) {
    return NextResponse.json(
      { ok: false, error: 'サーバー設定（MASTER_HUB_EDIT_COOKIE_SECRET）が未設定です' },
      { status: 500 },
    );
  }

  const res = NextResponse.json({ ok: true, enabled: true, configured: true });
  res.cookies.set({
    name: getCookieName(),
    value,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true, enabled: false });
  res.cookies.set({
    name: getCookieName(),
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return res;
}
