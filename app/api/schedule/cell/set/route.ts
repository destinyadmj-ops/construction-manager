import { prisma } from '@/server/db/prisma';
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
    slot1: z.string().trim().max(200).nullable().optional(),
    slot2: z.string().trim().max(200).nullable().optional(),
    slot1Color: LabelColorSchema.optional().nullable(),
    slot2Color: LabelColorSchema.optional().nullable(),
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

async function resolveSiteByName(
  siteName: string,
  kind: 'NORMAL' | 'DAILY',
): Promise<{ id: string; name: string } | null> {
  const name = normalizeRegistryText(siteName);
  if (!name) return null;

  const found = await findMatchingSite({ companyName: null, name, kind });
  if (found.site) return { id: found.site.id, name: found.site.name };

  const created = await prisma.site.create({ data: { name, kind }, select: { id: true, name: true } });
  return created;
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const { userId, day } = parsed.data;
  const kind = parsed.data.kind ?? 'NORMAL';

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return Response.json({ ok: false, error: 'User not found' }, { status: 404 });

    const startAt = startOfDayLocal(day);
    const until = addDays(startAt, 1);

    const slot1Name = (parsed.data.slot1 ?? null)?.trim() || null;
    const slot2Name = (parsed.data.slot2 ?? null)?.trim() || null;
    const slot1Color = parsed.data.slot1Color ?? 'default';
    const slot2Color = parsed.data.slot2Color ?? 'default';

    const [slot1Site, slot2Site] = await Promise.all([
      slot1Name ? resolveSiteByName(slot1Name, kind) : Promise.resolve(null),
      slot2Name ? resolveSiteByName(slot2Name, kind) : Promise.resolve(null),
    ]);

    await prisma.$transaction(async (tx) => {
      await tx.workEntry.deleteMany({ where: { userId, kind, startAt: { gte: startAt, lt: until } } });

      if (slot1Site) {
        await tx.workEntry.create({
          data: {
            userId,
            kind,
            startAt: addMinutes(startAt, 0),
            summary: slot1Site.name,
            siteId: slot1Site.id,
            accountingMeta: { siteName: slot1Site.name, labelColor: slot1Color },
          },
          select: { id: true },
        });
      }

      if (slot2Site) {
        await tx.workEntry.create({
          data: {
            userId,
            kind,
            startAt: addMinutes(startAt, 1),
            summary: slot2Site.name,
            siteId: slot2Site.id,
            accountingMeta: { siteName: slot2Site.name, labelColor: slot2Color },
          },
          select: { id: true },
        });
      }
    });

    try {
      if (slot1Site) {
        await ensureSiteDayFolders({ siteId: slot1Site.id, siteName: slot1Site.name, dayYmd: day });
      }
      if (slot2Site) {
        await ensureSiteDayFolders({ siteId: slot2Site.id, siteName: slot2Site.name, dayYmd: day });
      }
    } catch {
      // ignore history folder creation failure
    }

    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return Response.json({ ok: false, error: msg }, { status: 503 });
  }
}
