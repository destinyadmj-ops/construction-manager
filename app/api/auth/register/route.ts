import { prisma } from '@/server/db/prisma';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const COOKIE_NAME = 'masterHub.uid';

const RegisterSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(320).optional().nullable(),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
    registrationPassword: z.string().max(200).optional().nullable(),
  })
  .strict();

function isRegistrationAllowed(password: string) {
  const expected = (process.env.MASTER_HUB_REGISTRATION_PASSWORD ?? '').trim();
  if (!expected) return process.env.NODE_ENV !== 'production';
  return password === expected;
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

  if (!isRegistrationAllowed(password)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let userId: string;

    if (email) {
      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        const updated = await prisma.user.update({
          where: { id: existing.id },
          data: { name, kind },
          select: { id: true },
        });
        userId = updated.id;
      } else {
        const created = await prisma.user.create({ data: { name, email, kind }, select: { id: true } });
        userId = created.id;
      }
    } else {
      const created = await prisma.user.create({ data: { name, email: null, kind }, select: { id: true } });
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
    return res;
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}
