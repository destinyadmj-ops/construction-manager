import { prisma } from '@/server/db/prisma';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

const COOKIE_NAME = 'masterHub.uid';

async function requireUser() {
  const jar = await cookies();
  const userId = (jar.get(COOKIE_NAME)?.value ?? '').trim();
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user ? userId : null;
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

function startOfDayTokyo(ymd: string) {
  // Interpret as Tokyo midnight, convert to UTC Date
  // Tokyo is UTC+9; midnight JST = previous day 15:00 UTC
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  return new Date(Date.UTC(y, m - 1, d, -9, 0, 0));
}

export async function GET(request: Request) {
  const userId = await requireUser();
  if (!userId) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const siteId = (url.searchParams.get('siteId') ?? '').trim() || null;
  const dateYmdRaw = (url.searchParams.get('date') ?? '').trim();
  const dateYmd = /^\d{4}-\d{2}-\d{2}$/.test(dateYmdRaw) ? dateYmdRaw : ymdInTokyo(new Date());

  const dayStart = startOfDayTokyo(dateYmd);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const rows = await prisma.timeClock.findMany({
    where: {
      userId,
      ...(siteId ? { siteId } : {}),
      inAt: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { inAt: 'desc' },
    take: 50,
    select: { id: true, siteId: true, inAt: true, outAt: true, note: true },
  });

  return Response.json({
    ok: true,
    dateYmd,
    items: rows.map((r) => ({
      id: r.id,
      siteId: r.siteId,
      inAt: r.inAt.toISOString(),
      outAt: r.outAt ? r.outAt.toISOString() : null,
      note: r.note,
    })),
  });
}
