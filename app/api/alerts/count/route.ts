import { prisma } from '@/server/db/prisma';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function GET() {
  try {
    const now = new Date();
    const since = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const until = startOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 1));

    const [sites, grouped, invoiceFailed, reportFailed] = await Promise.all([
      prisma.site.findMany({
        take: 2000,
        select: { id: true, depreciationThreshold: true, alertsEnabled: true },
      }),
      prisma.workEntry.groupBy({
        by: ['siteId'],
        where: {
          siteId: { not: null },
          startAt: { gte: since, lt: until },
        },
        _count: { _all: true },
      }),
      prisma.outlookSendLog.count({
        where: {
          kind: 'INVOICE',
          status: 'FAILED',
          createdAt: { gte: since, lt: until },
        },
      }),
      prisma.outlookSendLog.count({
        where: {
          kind: 'REPORT',
          status: 'FAILED',
          createdAt: { gte: since, lt: until },
        },
      }),
    ]);

    const counts: Record<string, number> = {};
    for (const g of grouped) {
      if (!g.siteId) continue;
      counts[g.siteId] = g._count._all;
    }

    let deprAlertCount = 0;
    for (const s of sites) {
      const count = counts[s.id] ?? 0;
      const threshold = s.depreciationThreshold ?? 10;
      const alertsEnabled = s.alertsEnabled ?? true;
      if (alertsEnabled && count >= threshold) {
        deprAlertCount++;
      }
    }

    const total = deprAlertCount + invoiceFailed + reportFailed;

    return NextResponse.json({
      ok: true,
      total,
      depreciation: deprAlertCount,
      invoiceFailed,
      reportFailed,
    });
  } catch (error) {
    console.error('Failed to get alert count:', error);
    return NextResponse.json({
      ok: true,
      total: 0,
      depreciation: 0,
      invoiceFailed: 0,
      reportFailed: 0,
      degraded: true,
    });
  }
}
