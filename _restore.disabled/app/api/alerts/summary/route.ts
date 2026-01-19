import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = (url.searchParams.get('month') ?? '').trim();

  if (!/^[0-9]{4}-[0-9]{2}$/.test(month)) {
    return Response.json({ ok: false, error: 'month must be YYYY-MM' }, { status: 400 });
  }

  const base = new Date(`${month}-01T00:00:00`);
  const since = startOfDay(new Date(base.getFullYear(), base.getMonth(), 1));
  const until = startOfDay(new Date(base.getFullYear(), base.getMonth() + 1, 1));

  try {
    const sites = await prisma.site.findMany({
      orderBy: [{ companyName: 'asc' }, { name: 'asc' }],
      take: 2000,
      select: { id: true, depreciationThreshold: true, alertsEnabled: true },
    });

    const enabled = sites.filter((s) => (s.alertsEnabled ?? true) === true);
    const ids = enabled.map((s) => s.id);

    const grouped =
      ids.length === 0
        ? []
        : await prisma.workEntry.groupBy({
            by: ['siteId'],
            where: {
              siteId: { in: ids },
              startAt: { gte: since, lt: until },
            },
            _count: { _all: true },
          });

    const counts: Record<string, number> = {};
    for (const g of grouped) {
      if (!g.siteId) continue;
      counts[g.siteId] = g._count._all;
    }

    let depreciation = 0;
    for (const s of enabled) {
      const count = counts[s.id] ?? 0;
      const threshold = s.depreciationThreshold ?? 10;
      if (count >= threshold) depreciation++;
    }

    const [invoiceFailed, reportFailed] = await Promise.all([
      prisma.outlookSendLog.count({
        where: { kind: 'INVOICE', status: 'FAILED', createdAt: { gte: since, lt: until } },
      }),
      prisma.outlookSendLog.count({
        where: { kind: 'REPORT', status: 'FAILED', createdAt: { gte: since, lt: until } },
      }),
    ]);

    const total = depreciation + invoiceFailed + reportFailed;

    return Response.json({
      ok: true,
      month,
      counts: { depreciation, invoiceFailed, reportFailed },
      total,
      hasAlerts: total > 0,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}
