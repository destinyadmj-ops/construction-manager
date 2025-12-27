import { prisma } from '@/server/db/prisma';
import { Prisma } from '@/generated/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

type CellAction = 'toggle' | 'add' | 'remove' | 'replace2' | 'swap' | 'recolor';

const BodySchema = z
  .object({
    userId: z.string().min(1),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
    action: z.enum(['toggle', 'add', 'remove', 'replace2', 'swap', 'recolor']),
    siteId: z.string().min(1).optional().nullable(),
    siteName: z.string().min(1).max(200).optional().nullable(),
    color: z.enum(['default', 'red']).optional().nullable(),
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

function addMinutes(d: Date, minutes: number) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() + minutes);
  return x;
}

async function resolveSite(input: {
  siteId?: string | null;
  siteName?: string | null;
  kind: 'NORMAL' | 'DAILY';
}): Promise<
  | { ok: true; site: { id: string; name: string } }
  | { ok: false; status: number; error: string; reason?: string }
> {
  if (input.siteId) {
    const resolved = await prisma.site.findUnique({
      where: { id: input.siteId },
      select: { id: true, name: true },
    });
    if (!resolved) {
      return { ok: false, status: 404, error: 'Site not found', reason: 'site-not-found' };
    }
    return { ok: true, site: resolved };
  }

  const name = (input.siteName ?? '').trim();
  if (!name) return { ok: false, status: 400, error: 'siteId or siteName is required' };

  const found = await prisma.site.findFirst({
    where: { name, kind: input.kind },
    select: { id: true, name: true },
  });

  if (found) return { ok: true, site: found };

  const created = await prisma.site.create({
    data: { name, kind: input.kind },
    select: { id: true, name: true },
  });
  return { ok: true, site: created };
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { userId, day, action } = parsed.data as {
    userId: string;
    day: string;
    kind?: 'NORMAL' | 'DAILY';
    action: CellAction;
    siteId?: string | null;
    siteName?: string | null;
    color?: 'default' | 'red' | null;
  };

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
    select: { id: true, startAt: true, siteId: true, accountingMeta: true },
  });

  if (action === 'swap') {
    if (existing.length < 2) {
      return Response.json({ ok: true, action, changed: false, reason: 'not-enough-entries' });
    }

    const a = existing[0]!;
    const b = existing[1]!;

    await prisma.$transaction(async (tx) => {
      // Force deterministic slot ordering: slot1=00:00, slot2=00:01.
      // Avoid transient equal startAt by using a temporary offset.
      const tmp = addMinutes(startAt, 10);
      await tx.workEntry.update({ where: { id: a.id }, data: { startAt: tmp } });
      await tx.workEntry.update({ where: { id: b.id }, data: { startAt: addMinutes(startAt, 0) } });
      await tx.workEntry.update({ where: { id: a.id }, data: { startAt: addMinutes(startAt, 1) } });
    });

    return Response.json({ ok: true, action, changed: true });
  }

  const resolvedSite = await resolveSite({
    siteId: parsed.data.siteId,
    siteName: parsed.data.siteName,
    kind,
  });
  if (!resolvedSite.ok) {
    return Response.json(
      { ok: false, error: resolvedSite.error, reason: resolvedSite.reason },
      { status: resolvedSite.status },
    );
  }

  const site = resolvedSite.site;
  const desiredColor: 'default' | 'red' = parsed.data.color ?? 'default';

  const hit = existing.find((e) => (e.siteId ?? null) === site.id);

  if (action === 'recolor') {
    if (!hit) return Response.json({ ok: true, action, changed: false, reason: 'not-found' });
    await prisma.workEntry.update({
      where: { id: hit.id },
      data: {
        accountingMeta: mergeMeta(hit.accountingMeta, { siteName: site.name, labelColor: desiredColor }),
      },
      select: { id: true },
    });
    return Response.json({ ok: true, action, changed: true });
  }

  if (action === 'remove') {
    if (!hit) return Response.json({ ok: true, action, changed: false, reason: 'not-found' });
    await prisma.workEntry.delete({ where: { id: hit.id } });
    return Response.json({ ok: true, action, changed: true });
  }

  if (action === 'toggle') {
    if (hit) {
      await prisma.workEntry.delete({ where: { id: hit.id } });
      return Response.json({ ok: true, action, changed: true, toggled: 'off' });
    }
    // If it's already full (2 slots), toggle acts like replacing slot2 so a click always reflects.
    if (existing.length >= 2) {
      const second = existing[1];
      if (second) {
        const updated = await prisma.workEntry.update({
          where: { id: second.id },
          data: {
            summary: site.name,
            siteId: site.id,
            accountingMeta: mergeMeta(second.accountingMeta, { siteName: site.name, labelColor: desiredColor }),
          },
          select: { id: true },
        });

        return Response.json({ ok: true, action, changed: true, replaced: 'slot2', entry: updated });
      }
    }

    // fallthrough to add
  }

  if (hit) {
    return Response.json({ ok: true, action, changed: false, reason: 'already-exists' });
  }

  if (existing.length < 2) {
    const entry = await prisma.workEntry.create({
      data: {
        userId,
        kind,
        startAt: addMinutes(startAt, existing.length),
        summary: site.name,
        siteId: site.id,
        accountingMeta: { siteName: site.name, labelColor: desiredColor },
      },
      select: { id: true },
    });

    return Response.json({ ok: true, action, changed: true, entry });
  }

  if (action === 'replace2') {
    const second = existing[1];
    if (!second) {
      const entry = await prisma.workEntry.create({
        data: {
          userId,
          kind,
          startAt: addMinutes(startAt, 1),
          summary: site.name,
          siteId: site.id,
          accountingMeta: { siteName: site.name, labelColor: desiredColor },
        },
        select: { id: true },
      });
      return Response.json({ ok: true, action, changed: true, entry });
    }

    const updated = await prisma.workEntry.update({
      where: { id: second.id },
      data: {
        summary: site.name,
        siteId: site.id,
        accountingMeta: mergeMeta(second.accountingMeta, { siteName: site.name, labelColor: desiredColor }),
      },
      select: { id: true },
    });

    return Response.json({ ok: true, action, changed: true, entry: updated });
  }

  // action === 'add' (or toggle-add when empty) but cell is full
  return Response.json({ ok: true, action, changed: false, reason: 'cell-full' });
}
