import { prisma } from '@/server/db/prisma';
import { cookies } from 'next/headers';
import { z } from 'zod';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
};

const AUTH_COOKIE = 'masterHub.uid';

function isAdminTokenAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

async function canGrantByUserCookie(): Promise<boolean> {
  try {
    const jar = await cookies();
    const uid = (jar.get(AUTH_COOKIE)?.value ?? '').trim();
    if (!uid) return false;
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { canGrantScheduleEdit: true } });
    return u?.canGrantScheduleEdit === true;
  } catch {
    return false;
  }
}

const UpdateSchema = z
  .object({
    userId: z.string().min(1),
    canEditSchedule: z.boolean().optional(),
    canGrantScheduleEdit: z.boolean().optional(),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const kindParam = (url.searchParams.get('kind') ?? '').trim().toLowerCase();
    const kind = kindParam === 'daily' ? 'DAILY' : kindParam === 'normal' ? 'NORMAL' : undefined;

    const users = await prisma.user.findMany({
      where: kind ? { kind } : undefined,
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, kind: true, canEditSchedule: true, canGrantScheduleEdit: true },
      take: 500,
    });

    return Response.json({ ok: true, users }, { headers: NO_STORE_HEADERS });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: Request) {
  const allow = isAdminTokenAuthorized(request) || (await canGrantByUserCookie());
  if (!allow) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  if (parsed.data.canEditSchedule === undefined && parsed.data.canGrantScheduleEdit === undefined) {
    return Response.json({ ok: false, error: 'No changes' }, { status: 400 });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: parsed.data.userId },
      data: {
        ...(parsed.data.canEditSchedule !== undefined ? { canEditSchedule: parsed.data.canEditSchedule } : {}),
        ...(parsed.data.canGrantScheduleEdit !== undefined
          ? { canGrantScheduleEdit: parsed.data.canGrantScheduleEdit }
          : {}),
      },
      select: { id: true, canEditSchedule: true, canGrantScheduleEdit: true },
    });

    return Response.json({ ok: true, user: updated });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Update failed' },
      { status: 503 },
    );
  }
}
