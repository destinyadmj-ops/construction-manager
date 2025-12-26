import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteId = (url.searchParams.get('siteId') ?? '').trim();
  const month = (url.searchParams.get('month') ?? '').trim();

  if (!siteId) {
    return Response.json({ ok: false, error: 'siteId is required' }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return Response.json({ ok: false, error: 'month must be YYYY-MM' }, { status: 400 });
  }

  const base = new Date(`${month}-01T00:00:00`);
  const since = startOfDay(new Date(base.getFullYear(), base.getMonth(), 1));
  const until = startOfDay(new Date(base.getFullYear(), base.getMonth() + 1, 1));

  try {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { depreciationThreshold: true },
    });

    const count = await prisma.workEntry.count({
      where: {
        siteId,
        startAt: { gte: since, lt: until },
      },
    });

    const threshold = site?.depreciationThreshold ?? 10;
    return Response.json({ ok: true, siteId, month, count, threshold, alert: count >= threshold });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}
