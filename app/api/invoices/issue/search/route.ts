import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseYmd(input: string): Date | null {
  const v = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fromStr = (url.searchParams.get('from') ?? '').trim();
  const toStr = (url.searchParams.get('to') ?? '').trim();
  const companyQuery = (url.searchParams.get('company') ?? '').trim();

  const from = parseYmd(fromStr);
  const to = parseYmd(toStr);
  if (!from || !to) {
    return Response.json({ ok: false, error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
  }
  if (from.getTime() > to.getTime()) {
    return Response.json({ ok: false, error: 'from must be <= to' }, { status: 400 });
  }

  const since = startOfDay(from);
  const until = startOfDay(new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1));

  try {
    const month = fromStr.slice(0, 7);
    const monthBase = new Date(`${month}-01T00:00:00`);
    const monthSince = startOfDay(new Date(monthBase.getFullYear(), monthBase.getMonth(), 1));
    const monthUntil = startOfDay(new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 1));

    const sites = await prisma.site.findMany({
      where: companyQuery
        ? {
            OR: [
              { companyName: { contains: companyQuery, mode: 'insensitive' } },
              { name: { contains: companyQuery, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: [{ companyName: 'asc' }, { name: 'asc' }],
      take: 1000,
      select: { id: true, companyName: true, name: true, alertsEnabled: true },
    });

    const siteIds = sites.map((s) => s.id);

    const [grouped, docs] = await Promise.all([
      siteIds.length === 0
        ? []
        : prisma.workEntry.groupBy({
            by: ['siteId'],
            where: { siteId: { in: siteIds }, startAt: { gte: since, lt: until } },
            _count: { _all: true },
          }),
      siteIds.length === 0
        ? []
        : prisma.storedDocument.findMany({
            where: {
              siteId: { in: siteIds },
              kind: 'INVOICE',
              createdAt: { gte: monthSince, lt: monthUntil },
            },
            select: { siteId: true },
          }),
    ]);

    const workCountBySite: Record<string, number> = {};
    for (const g of grouped) {
      if (!g.siteId) continue;
      workCountBySite[g.siteId] = g._count._all;
    }

    const issuedSet = new Set(docs.map((d) => d.siteId).filter((x): x is string => !!x));

    const companyNames = Array.from(
      new Set(sites.map((s) => (s.companyName ?? '').trim()).filter((x) => x.length > 0)),
    );

    const partners =
      companyNames.length === 0
        ? []
        : await prisma.partner.findMany({
            where: { name: { in: companyNames } },
            select: { id: true, name: true, email: true, fax: true },
          });

    const partnerByName: Record<string, { id: string; name: string; email: string | null; fax: string | null }> = {};
    for (const p of partners) {
      partnerByName[p.name] = { id: p.id, name: p.name, email: p.email, fax: p.fax };
    }

    const items = sites
      .map((s) => {
        const count = workCountBySite[s.id] ?? 0;
        if (count <= 0) return null;

        const companyName = s.companyName;
        const label = `${companyName ? `${companyName} / ` : ''}${s.name}`.trim();
        const partner = companyName ? partnerByName[companyName] ?? null : null;

        return {
          siteId: s.id,
          siteLabel: label,
          companyName,
          alertsEnabled: s.alertsEnabled ?? true,
          workCount: count,
          invoiceIssuedThisMonth: issuedSet.has(s.id),
          partner: partner
            ? {
                id: partner.id,
                name: partner.name,
                email: partner.email,
                fax: partner.fax,
              }
            : null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    return Response.json({ ok: true, from: fromStr, to: toStr, month, items });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}
