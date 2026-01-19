import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const QuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    userIds: z.string().optional(),
    siteId: z.string().min(1).optional(),
  })
  .strict();

function startOfDayTokyo(ymd: string) {
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  return new Date(Date.UTC(y, m - 1, d, -9, 0, 0));
}

function ymdInTokyo(d: Date) {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function minutesToHourText(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = {
    from: (url.searchParams.get('from') ?? '').trim(),
    to: (url.searchParams.get('to') ?? '').trim(),
    userIds: (url.searchParams.get('userIds') ?? '').trim() || undefined,
    siteId: (url.searchParams.get('siteId') ?? '').trim() || undefined,
  };

  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid query', issues: parsed.error.issues }, { status: 400 });
  }

  const fromYmd = parsed.data.from;
  const toYmd = parsed.data.to;
  const from = startOfDayTokyo(fromYmd);
  const toNext = new Date(startOfDayTokyo(toYmd).getTime() + 24 * 60 * 60 * 1000);

  const userIdList = parsed.data.userIds
    ? Array.from(new Set(parsed.data.userIds.split(',').map((s) => s.trim()).filter(Boolean))).slice(0, 200)
    : null;

  const siteId = parsed.data.siteId;
  const siteWhere = !siteId ? null : siteId === '__none__' ? ({ siteId: null } as const) : ({ siteId } as const);

  try {
    const rows = await prisma.timeClock.findMany({
      where: {
        inAt: { gte: from, lt: toNext },
        ...(userIdList ? { userId: { in: userIdList } } : {}),
        ...(siteWhere ? siteWhere : {}),
        user: { kind: 'DAILY' },
      },
      orderBy: { inAt: 'asc' },
      select: {
        userId: true,
        inAt: true,
        outAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      take: 20000,
    });

    const byUser = new Map<
      string,
      {
        user: { id: string; name: string | null; email: string | null };
        days: Set<string>;
        totalMinutes: number;
      }
    >();

    for (const r of rows) {
      const u = r.user;
      const key = r.userId;
      const dayKey = ymdInTokyo(r.inAt);
      const bucket = byUser.get(key) ?? { user: u, days: new Set<string>(), totalMinutes: 0 };
      bucket.days.add(dayKey);
      if (r.outAt) {
        const ms = r.outAt.getTime() - r.inAt.getTime();
        if (ms > 0) bucket.totalMinutes += Math.floor(ms / 60000);
      }
      byUser.set(key, bucket);
    }

    const items = Array.from(byUser.values())
      .map((b) => ({
        userId: b.user.id,
        name: b.user.name,
        email: b.user.email,
        workDays: b.days.size,
        workMinutes: b.totalMinutes,
        workHoursText: minutesToHourText(b.totalMinutes),
      }))
      .sort((a, b) => (a.name ?? a.email ?? a.userId).localeCompare(b.name ?? b.email ?? b.userId, 'ja'));

    return Response.json({ ok: true, from: fromYmd, to: toYmd, items });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}
