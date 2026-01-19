import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseMonth(month: string) {
  if (!/^[0-9]{4}-[0-9]{2}$/.test(month)) return null;
  const base = new Date(`${month}-01T00:00:00`);
  const since = startOfDay(new Date(base.getFullYear(), base.getMonth(), 1));
  const until = startOfDay(new Date(base.getFullYear(), base.getMonth() + 1, 1));
  return { since, until };
}

function decToNumber(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'object' && v && 'toString' in v) {
    try {
      const n = Number(String((v as { toString: () => string }).toString()));
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

function toYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = (url.searchParams.get('month') ?? '').trim();

  const range = parseMonth(month);
  if (!range) {
    return Response.json({ ok: false, error: 'month must be YYYY-MM' }, { status: 400 });
  }

  const { since, until } = range;

  try {
    const grouped = await prisma.workEntry.groupBy({
      by: ['accountingType'],
      where: {
        startAt: { gte: since, lt: until },
        accountingType: { not: null },
        amount: { not: null },
      },
      _sum: { amount: true },
    });

    let expense = 0;
    let labor = 0;
    let sales = 0;

    for (const g of grouped) {
      const sum = decToNumber(g._sum.amount);
      if (g.accountingType === 'EXPENSE') expense += sum;
      if (g.accountingType === 'LABOR') labor += sum;
      if (g.accountingType === 'ACCOUNTS_RECEIVABLE') sales += sum;
    }

    const receivableRows = await prisma.workEntry.findMany({
      where: {
        startAt: { gte: since, lt: until },
        accountingType: 'ACCOUNTS_RECEIVABLE',
        amount: { not: null },
      },
      select: { startAt: true, amount: true },
      take: 20_000,
    });

    const daily: Record<string, number> = {};
    for (const r of receivableRows) {
      const dayKey = toYmd(r.startAt);
      daily[dayKey] = (daily[dayKey] ?? 0) + decToNumber(r.amount);
    }

    const dailySales = Object.entries(daily)
      .map(([day, value]) => ({ day, value }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

    return Response.json({
      ok: true,
      month,
      totals: {
        sales,
        expense,
        labor,
        net: sales - expense - labor,
      },
      dailySales,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}
