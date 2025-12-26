import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';

function extractSiteNames(meta: unknown): string[] {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
  const m = meta as Record<string, unknown>;

  const candidates: unknown[] = [m.siteNames, m.siteName, m.genbaNames, m.genbaName];

  const result: string[] = [];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const s = c.trim();
      if (s) result.push(s);
      continue;
    }
    if (Array.isArray(c)) {
      for (const item of c) {
        if (typeof item === 'string') {
          const s = item.trim();
          if (s) result.push(s);
        }
      }
    }
  }

  return Array.from(new Set(result));
}

// Returns a recent unique list of site names for quick input.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '200') || 200, 1), 1000);

  const sites = await prisma.site.findMany({
    orderBy: [{ companyName: 'asc' }, { name: 'asc' }],
    take: 500,
    select: { id: true, name: true, companyName: true },
  });

  const ledgerItems = sites
    .map((s) => {
      const company = (s.companyName ?? '').trim();
      const name = (s.name ?? '').trim();
      if (!name) return null;
      const label = company ? `${company} / ${name}` : name;
      return { id: s.id, label, name, companyName: company || null };
    })
    .filter((x): x is { id: string; label: string; name: string; companyName: string | null } =>
      Boolean(x),
    );

  if (ledgerItems.length > 0) {
    return Response.json({
      ok: true,
      sites: ledgerItems.slice(0, 200),
      names: ledgerItems.slice(0, 200).map((x) => x.label),
    });
  }

  const rows = await prisma.workEntry.findMany({
    orderBy: { startAt: 'desc' },
    take: limit,
    select: { accountingMeta: true, summary: true, note: true },
  });

  const names: string[] = [];
  for (const r of rows) {
    const metaNames = extractSiteNames(r.accountingMeta);
    for (const n of metaNames) names.push(n);

    // Fallback: allow summary/note to act as a proto-site name if no meta.
    if (metaNames.length === 0) {
      const s = (r.summary ?? r.note ?? '').toString().trim();
      if (s) names.push(s);
    }
  }

  const unique = Array.from(new Set(names)).slice(0, 200);
  return Response.json({ ok: true, names: unique, sites: [] });
}
