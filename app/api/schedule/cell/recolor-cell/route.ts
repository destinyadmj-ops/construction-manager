import { prisma } from '@/server/db/prisma';
import { Prisma } from '@/generated/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const LabelColorSchema = z.enum(['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']);

const BodySchema = z
  .object({
    userId: z.string().min(1),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
    color: LabelColorSchema,
  })
  .strict();

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function mergeMeta(base: unknown, patch: Record<string, unknown>): Prisma.InputJsonValue {
  const b = asObject(base) ?? {};
  return { ...b, ...patch } as Prisma.InputJsonObject;
}

function startOfDayLocal(ymd: string) {
  // ISO without timezone is treated as local time.
  const d = new Date(`${ymd}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const { userId, day, color } = parsed.data;
  const kind = parsed.data.kind ?? 'NORMAL';

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    return Response.json({ ok: false, error: 'User not found' }, { status: 404 });
  }

  const startAt = startOfDayLocal(day);
  const until = addDays(startAt, 1);

  const existing = await prisma.workEntry.findMany({
    where: { userId, kind, startAt: { gte: startAt, lt: until } },
    orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, accountingMeta: true },
  });

  if (existing.length === 0) {
    return Response.json({ ok: true, changed: 0 });
  }

  await prisma.$transaction(
    existing.map((e) =>
      prisma.workEntry.update({
        where: { id: e.id },
        data: {
          accountingMeta: mergeMeta(e.accountingMeta, { labelColor: color }),
        },
        select: { id: true },
      }),
    ),
  );

  return Response.json({ ok: true, changed: existing.length });
}
