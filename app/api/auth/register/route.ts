import { prisma } from '@/server/db/prisma';
import { rememberUserLoginDevice } from '@/server/auth/login-memory';
import { isMobileRequest } from '@/server/auth/schedule-edit';
import { hashUserPassword, validateUserPassword } from '@/server/auth/user-password';
import { createUserLoginNotification } from '@/server/notifications/user-login';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const COOKIE_NAME = 'masterHub.uid';

const DeviceSchema = z
  .object({
    deviceKey: z.string().min(16).max(200),
    host: z.string().max(200).optional(),
    platform: z.string().max(200).optional(),
    language: z.string().max(100).optional(),
    timeZone: z.string().max(100).optional(),
  })
  .strict();

const RegisterSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(320).optional().nullable(),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
    registrationPassword: z.string().max(200).optional().nullable(),
    userPassword: z.string().max(200).optional().nullable(),
    device: DeviceSchema.optional(),
  })
  .strict();

function isRegistrationAllowed(password: string) {
  const expected = (process.env.MASTER_HUB_REGISTRATION_PASSWORD ?? '').trim();
  if (!expected) return process.env.NODE_ENV !== 'production';
  return password === expected;
}

function toReadableDbErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : 'DB unavailable';
  const lower = msg.toLowerCase();

  if (lower.includes('authentication failed') || lower.includes('p1000')) {
    return 'DB認証に失敗しました。Supabase の DATABASE_URL（ユーザー名・パスワード・Pooler設定）を確認してください。';
  }
  if (lower.includes('denied access') || lower.includes('permission denied')) {
    return 'DBアクセス権限が不足しています。Supabase 接続文字列とロール権限を確認してください。';
  }
  if (lower.includes('table') && lower.includes('does not exist')) {
    return 'DBスキーマが未適用です。`npm run db:deploy` を実行してください。';
  }
  return msg;
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = RegisterSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const name = parsed.data.name.trim();
  const email = typeof parsed.data.email === 'string' ? parsed.data.email.trim() || null : null;
  const kind = parsed.data.kind ?? 'NORMAL';
  const password = (parsed.data.registrationPassword ?? '').toString();
  const userPassword = (parsed.data.userPassword ?? '').toString();

  if (!isRegistrationAllowed(password)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const isDesktopRegistration = !isMobileRequest(request);
  if (isDesktopRegistration) {
    const passwordError = validateUserPassword(userPassword);
    if (passwordError) {
      return Response.json({ ok: false, error: passwordError, code: 'USER_PASSWORD_REQUIRED' }, { status: 400 });
    }
  }

  try {
    let userId: string;
    const nextPasswordHash = userPassword ? await hashUserPassword(userPassword) : null;
    const nextPasswordSetAt = nextPasswordHash ? new Date() : null;

    if (email) {
      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true, passwordHash: true },
      });
      if (existing) {
        const updated = await prisma.user.update({
          where: { id: existing.id },
          data: {
            name,
            kind,
            ...(nextPasswordHash && !existing.passwordHash
              ? { passwordHash: nextPasswordHash, passwordSetAt: nextPasswordSetAt }
              : {}),
          },
          select: { id: true },
        });
        userId = updated.id;
      } else {
        const created = await prisma.user.create({
          data: {
            name,
            email,
            kind,
            ...(nextPasswordHash ? { passwordHash: nextPasswordHash, passwordSetAt: nextPasswordSetAt } : {}),
          },
          select: { id: true },
        });
        userId = created.id;
      }
    } else {
      const created = await prisma.user.create({
        data: {
          name,
          email: null,
          kind,
          ...(nextPasswordHash ? { passwordHash: nextPasswordHash, passwordSetAt: nextPasswordSetAt } : {}),
        },
        select: { id: true },
      });
      userId = created.id;
    }

    const res = NextResponse.json({ ok: true, userId });
    res.cookies.set({
      name: COOKIE_NAME,
      value: userId,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });

    await rememberUserLoginDevice(request, userId, parsed.data.device);
    await createUserLoginNotification(request, userId, parsed.data.device);
    return res;
  } catch (e) {
    return Response.json(
      { ok: false, error: toReadableDbErrorMessage(e) },
      { status: 503 },
    );
  }
}
