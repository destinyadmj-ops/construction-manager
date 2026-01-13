import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const BodySchema = z
  .object({
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
    from: z.object({ userId: z.string().min(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    to: z.object({ userId: z.string().min(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  })
  .strict();

function startOfDayLocal(ymd: string) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function addMinutes(d: Date, minutes: number) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() + minutes);
  return x;
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const kind = parsed.data.kind ?? 'NORMAL';
  const from = parsed.data.from;
  const to = parsed.data.to;

  if (from.userId === to.userId && from.day === to.day) {
    return Response.json({ ok: true, changed: false, reason: 'same-cell' });
  }

  const fromUser = await prisma.user.findUnique({ where: { id: from.userId }, select: { id: true } });
  if (!fromUser) return Response.json({ ok: false, error: 'From user not found' }, { status: 404 });
  const toUser = await prisma.user.findUnique({ where: { id: to.userId }, select: { id: true } });
  if (!toUser) return Response.json({ ok: false, error: 'To user not found' }, { status: 404 });

  const fromStart = startOfDayLocal(from.day);
  const toStart = startOfDayLocal(to.day);
  const fromUntil = addDays(fromStart, 1);
  const toUntil = addDays(toStart, 1);

  const [fromEntries, toEntries] = await Promise.all([
    prisma.workEntry.findMany({
      where: { userId: from.userId, kind, startAt: { gte: fromStart, lt: fromUntil } },
      orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
      take: 2,
      select: { id: true },
    }),
    prisma.workEntry.findMany({
      where: { userId: to.userId, kind, startAt: { gte: toStart, lt: toUntil } },
      orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
      take: 2,
      select: { id: true },
    }),
  ]);

  const tmpBase = addMinutes(new Date(Math.max(fromStart.getTime(), toStart.getTime())), 600);

  await prisma.$transaction(async (tx) => {
    const all = [...fromEntries, ...toEntries];
    // Move all involved entries to a temporary range first (avoids transient collisions).
    for (let i = 0; i < all.length; i++) {
      await tx.workEntry.update({ where: { id: all[i]!.id }, data: { startAt: addMinutes(tmpBase, i) } });
    }

    for (let i = 0; i < fromEntries.length; i++) {
      await tx.workEntry.update({
        where: { id: fromEntries[i]!.id },
        data: { userId: to.userId, kind, startAt: addMinutes(toStart, i) },
      });
    }

    for (let i = 0; i < toEntries.length; i++) {
      await tx.workEntry.update({
        where: { id: toEntries[i]!.id },
        data: { userId: from.userId, kind, startAt: addMinutes(fromStart, i) },
      });
    }
  });

  return Response.json({ ok: true, changed: true });
}
