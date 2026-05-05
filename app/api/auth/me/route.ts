import { prisma } from '@/server/db/prisma';
import { canRestoreUserLogin, rememberUserLoginDevice } from '@/server/auth/login-memory';
import { getCookieName as getEditModeCookieName, isEditModeConfigured, validateEditCookieValue } from '@/server/auth/edit-mode';
import { isMobileRequest } from '@/server/auth/schedule-edit';
import { hashUserPassword, validateUserPassword, verifyUserPassword } from '@/server/auth/user-password';
import { createUserLoginNotification } from '@/server/notifications/user-login';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

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

const SetSchema = z
  .object({
    userId: z.string().min(1).max(200),
    restore: z.boolean().optional(),
    password: z.string().max(200).optional(),
    newPassword: z.string().max(200).optional(),
    device: DeviceSchema.optional(),
  })
  .strict();

export async function GET() {
  try {
    const jar = await cookies();
    const userId = (jar.get(COOKIE_NAME)?.value ?? '').trim();
    const editConfigured = isEditModeConfigured();
    const editEnabled = editConfigured ? validateEditCookieValue(jar.get(getEditModeCookieName())?.value) : true;
    if (!userId) {
      return Response.json(
        { ok: true, user: null, editMode: { configured: editConfigured, enabled: editEnabled } },
        { headers: NO_STORE_HEADERS },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        kind: true,
        canEditSchedule: true,
        canGrantScheduleEdit: true,
      },
    });

    if (!user) {
      return Response.json(
        { ok: true, user: null, editMode: { configured: editConfigured, enabled: editEnabled } },
        { headers: NO_STORE_HEADERS },
      );
    }
    return Response.json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        kind: user.kind,
        canEditSchedule: user.canEditSchedule,
        canGrantScheduleEdit: user.canGrantScheduleEdit,
        passwordConfigured: null,
        passwordSetAt: null,
      },
      editMode: { configured: editConfigured, enabled: editEnabled },
    }, { headers: NO_STORE_HEADERS });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = SetSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const userId = parsed.data.userId.trim();
    const mobileRequest = isMobileRequest(request);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) return Response.json({ ok: false, error: 'User not found' }, { status: 404 });

    if (parsed.data.restore) {
      const canRestore = await canRestoreUserLogin(request, userId, parsed.data.device);
      if (!canRestore) {
        return Response.json({ ok: false, error: 'Saved login could not be restored on this device' }, { status: 401 });
      }
    } else if (!mobileRequest) {
      const passwordHash = 'passwordHash' in user && typeof user.passwordHash === 'string' ? user.passwordHash : null;
      if (!passwordHash) {
        const passwordError = validateUserPassword(parsed.data.newPassword ?? '');
        if (passwordError) {
          return Response.json(
            { ok: false, error: passwordError, code: 'PASSWORD_SETUP_REQUIRED' },
            { status: 428 },
          );
        }

        await prisma.user.update({
          where: { id: userId },
          data: {
            passwordHash: await hashUserPassword(parsed.data.newPassword ?? ''),
            passwordSetAt: new Date(),
          },
        });
      } else {
        const verified = await verifyUserPassword(parsed.data.password ?? '', passwordHash);
        if (!verified) {
          return Response.json(
            { ok: false, error: 'パスワードが正しくありません', code: 'INVALID_PASSWORD' },
            { status: 401 },
          );
        }
      }
    }

    const res = NextResponse.json({ ok: true });
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
    if (!parsed.data.restore) {
      await createUserLoginNotification(request, userId, parsed.data.device);
    }
    return res;
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return res;
}
