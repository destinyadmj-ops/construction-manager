import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const BodySchema = z
  .object({
    userId: z.string().min(1),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    slot1: z.string().trim().max(200).nullable().optional(),
    slot2: z.string().trim().max(200).nullable().optional(),
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

async function resolveSiteByName(siteName: string): Promise<{ id: string; name: string } | null> {
  const name = siteName.trim();
  if (!name) return null;

  const found = await prisma.site.findFirst({ where: { name }, select: { id: true, name: true } });
  if (found) return found;

  const created = await prisma.site.create({ data: { name }, select: { id: true, name: true } });
  return created;
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const { userId, day } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return Response.json({ ok: false, error: 'User not found' }, { status: 404 });

    const startAt = startOfDayLocal(day);
    const until = addDays(startAt, 1);

    const slot1Name = (parsed.data.slot1 ?? null)?.trim() || null;
    const slot2Name = (parsed.data.slot2 ?? null)?.trim() || null;

    const [slot1Site, slot2Site] = await Promise.all([
      slot1Name ? resolveSiteByName(slot1Name) : Promise.resolve(null),
      slot2Name ? resolveSiteByName(slot2Name) : Promise.resolve(null),
    ]);

    await prisma.$transaction(async (tx) => {
      await tx.workEntry.deleteMany({ where: { userId, startAt: { gte: startAt, lt: until } } });

      if (slot1Site) {
        await tx.workEntry.create({
          data: {
            userId,
            startAt: addMinutes(startAt, 0),
            summary: slot1Site.name,
            siteId: slot1Site.id,
            accountingMeta: { siteName: slot1Site.name },
          },
          select: { id: true },
        });
      }

      if (slot2Site) {
        await tx.workEntry.create({
          data: {
            userId,
            startAt: addMinutes(startAt, 1),
            summary: slot2Site.name,
            siteId: slot2Site.id,
            accountingMeta: { siteName: slot2Site.name },
          },
          select: { id: true },
        });
      }
    });

    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return Response.json({ ok: false, error: msg }, { status: 503 });
  }
}
