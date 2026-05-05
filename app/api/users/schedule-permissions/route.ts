import { prisma } from '@/server/db/prisma';
import { requireUserManager } from '@/server/auth/user-admin';
import { z } from 'zod';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
};

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
      select: {
        id: true,
        name: true,
        email: true,
        kind: true,
        canEditSchedule: true,
        canGrantScheduleEdit: true,
        passwordHash: true,
        passwordSetAt: true,
      },
      take: 500,
    });

    return Response.json(
      {
        ok: true,
        users: users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          kind: user.kind,
          canEditSchedule: user.canEditSchedule,
          canGrantScheduleEdit: user.canGrantScheduleEdit,
          passwordConfigured: !!user.passwordHash,
          passwordSetAt: user.passwordSetAt,
        })),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: Request) {
  const authError = await requireUserManager(request);
  if (authError) return authError;

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
