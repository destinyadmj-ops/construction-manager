import { prisma } from '@/server/db/prisma';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

const COOKIE_NAME = 'masterHub.uid';
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

async function requireUser() {
  const jar = await cookies();
  const userId = (jar.get(COOKIE_NAME)?.value ?? '').trim();
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user ? userId : null;
}

function parseKindParam(kind: string | null) {
  const value = (kind ?? '').trim().toLowerCase();
  if (value === 'daily') return 'DAILY' as const;
  if (value === 'normal') return 'NORMAL' as const;
  return null;
}

export async function GET(request: Request) {
  const userId = await requireUser();
  if (!userId) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  try {
    const url = new URL(request.url);
    const kind = parseKindParam(url.searchParams.get('kind'));

    const sites = await prisma.site.findMany({
      where: kind ? { kind } : undefined,
      orderBy: [{ companyName: 'asc' }, { name: 'asc' }],
      take: 1000,
      select: {
        id: true,
        companyName: true,
        name: true,
        kind: true,
        caution: true,
        scheduleLabelColor: true,
      },
    });

    if (sites.length === 0) {
      return Response.json({ ok: true, sites: [] }, { headers: NO_STORE_HEADERS });
    }

    const siteIds = sites.map((site) => site.id);

    const [counts, latestGroups] = await Promise.all([
      prisma.storedDocument.groupBy({
        by: ['siteId'],
        where: { kind: 'WORK_SLIP', siteId: { in: siteIds } },
        _count: { _all: true },
      }),
      prisma.storedDocument.groupBy({
        by: ['siteId'],
        where: { kind: 'WORK_SLIP', siteId: { in: siteIds } },
        _max: { createdAt: true },
      }),
    ]);

    const countMap = new Map<string, number>();
    for (const row of counts) {
      if (row.siteId) countMap.set(row.siteId, row._count._all);
    }

    const latestOr = latestGroups
      .filter((row): row is { siteId: string; _max: { createdAt: Date | null } } => !!row.siteId && !!row._max.createdAt)
      .map((row) => ({ siteId: row.siteId, kind: 'WORK_SLIP' as const, createdAt: row._max.createdAt! }));

    const latestRows = latestOr.length
      ? await prisma.storedDocument.findMany({
          where: { OR: latestOr },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, siteId: true, fileName: true, createdAt: true, bizDateYmd: true, sizeBytes: true },
        })
      : [];

    const latestMap = new Map<string, (typeof latestRows)[number]>();
    for (const row of latestRows) {
      if (row.siteId && !latestMap.has(row.siteId)) latestMap.set(row.siteId, row);
    }

    const items = sites.map((site) => {
      const latest = latestMap.get(site.id) ?? null;
      return {
        id: site.id,
        companyName: site.companyName,
        name: site.name,
        kind: site.kind,
        caution: site.caution,
        scheduleLabelColor: site.scheduleLabelColor,
        workSlipCount: countMap.get(site.id) ?? 0,
        latestWorkSlip: latest
          ? {
              id: latest.id,
              fileName: latest.fileName,
              createdAt: latest.createdAt.toISOString(),
              bizDateYmd: latest.bizDateYmd,
              sizeBytes: latest.sizeBytes,
            }
          : null,
      };
    });

    return Response.json({ ok: true, sites: items }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load work slips' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}