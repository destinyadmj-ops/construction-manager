import { prisma } from '@/server/db/prisma';
import { Prisma } from '@/generated/prisma';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import { findMatchingSite, normalizeRegistryText } from '@/server/site-registry';
import { ensureSiteDayFolders } from '@/server/site-storage';
import { z } from 'zod';

export const runtime = 'nodejs';

const LabelColorSchema = z.enum(['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']);

const BodySchema = z
  .object({
    userId: z.string().min(1),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
    slot1: z.string().max(200).optional().nullable(),
    slot2: z.string().max(200).optional().nullable(),
    slot1Color: LabelColorSchema.optional().nullable(),
    slot2Color: LabelColorSchema.optional().nullable(),
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
  siteName: string;
  kind: 'NORMAL' | 'DAILY';
}): Promise<
  | { ok: true; site: { id: string; name: string } }
  | { ok: false; status: number; error: string; reason?: string }
> {
  const name = normalizeRegistryText(input.siteName ?? '');
  if (!name) return { ok: false, status: 400, error: 'siteName is required' };

  const found = await findMatchingSite({ companyName: null, name, kind: input.kind });

  if (found.site) return { ok: true, site: { id: found.site.id, name: found.site.name } };

  const created = await prisma.site.create({
    data: { name, kind: input.kind },
    select: { id: true, name: true },
  });
  return { ok: true, site: created };
}

export async function POST(request: Request) {
  const authError = await requireScheduleEditor(request);
  if (authError) return authError;

  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const kind = parsed.data.kind ?? 'NORMAL';

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true } });
  if (!user) {
    return Response.json({ ok: false, error: 'User not found' }, { status: 404 });
  }

  const startAt = startOfDayLocal(parsed.data.day);
  const until = addDays(startAt, 1);

  const existing = await prisma.workEntry.findMany({
    where: { userId: parsed.data.userId, kind, startAt: { gte: startAt, lt: until } },
    orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, startAt: true, siteId: true, accountingMeta: true },
  });

  const normalize = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim();
    return t ? t : null;
  };

  // Shift up if slot1 is empty and slot2 exists (keep color paired).
  const rawDesired = [
    { name: normalize(parsed.data.slot1 ?? null), color: parsed.data.slot1Color ?? 'default' },
    { name: normalize(parsed.data.slot2 ?? null), color: parsed.data.slot2Color ?? 'default' },
  ].filter((x) => !!x.name);

  const desired1 = rawDesired[0]?.name ?? null;
  const desired2 = rawDesired[1]?.name ?? null;
  const desired1Color = rawDesired[0]?.color ?? 'default';
  const desired2Color = rawDesired[1]?.color ?? 'default';

  let site1: { id: string; name: string } | null = null;
  if (desired1) {
    const r1 = await resolveSite({ siteName: desired1, kind });
    if (!r1.ok) {
      return Response.json({ ok: false, error: r1.error, reason: r1.reason }, { status: r1.status });
    }
    site1 = r1.site;
  }

  let site2: { id: string; name: string } | null = null;
  if (desired2) {
    const r2 = await resolveSite({ siteName: desired2, kind });
    if (!r2.ok) {
      return Response.json({ ok: false, error: r2.error, reason: r2.reason }, { status: r2.status });
    }
    site2 = r2.site;
  }

  await prisma.$transaction(async (tx) => {
    const extra = existing.slice(2);
    if (extra.length > 0) {
      await tx.workEntry.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
    }

    const e1 = existing[0] ?? null;
    const e2 = existing[1] ?? null;

      const patch1 = site1 ? { siteName: site1.name, labelColor: desired1Color } : null;
      const patch2 = site2 ? { siteName: site2.name, labelColor: desired2Color } : null;

    if (!patch1) {
      if (e1) await tx.workEntry.delete({ where: { id: e1.id } });
    } else if (e1) {
      await tx.workEntry.update({
        where: { id: e1.id },
        data: {
          startAt: addMinutes(startAt, 0),
          summary: site1!.name,
          siteId: site1!.id,
          accountingMeta: mergeMeta(e1.accountingMeta, patch1),
        },
      });
    } else {
      await tx.workEntry.create({
        data: {
          userId: parsed.data.userId,
          kind,
          startAt: addMinutes(startAt, 0),
          summary: site1!.name,
          siteId: site1!.id,
          accountingMeta: patch1 as Prisma.InputJsonValue,
        },
      });
    }

    if (!patch2) {
      if (e2) await tx.workEntry.delete({ where: { id: e2.id } });
    } else if (e2) {
      await tx.workEntry.update({
        where: { id: e2.id },
        data: {
          startAt: addMinutes(startAt, 1),
          summary: site2!.name,
          siteId: site2!.id,
          accountingMeta: mergeMeta(e2.accountingMeta, patch2),
        },
      });
    } else {
      await tx.workEntry.create({
        data: {
          userId: parsed.data.userId,
          kind,
          startAt: addMinutes(startAt, 1),
          summary: site2!.name,
          siteId: site2!.id,
          accountingMeta: patch2 as Prisma.InputJsonValue,
        },
      });
    }
  });

  // Create per-site per-day folder (best effort)
  try {
    if (site1) {
      await ensureSiteDayFolders({ siteId: site1.id, siteName: site1.name, dayYmd: parsed.data.day });
    }
    if (site2) {
      await ensureSiteDayFolders({ siteId: site2.id, siteName: site2.name, dayYmd: parsed.data.day });
    }
  } catch {
    // ignore
  }

  return Response.json({ ok: true });
}
