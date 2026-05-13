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

type SummaryItem = {
  siteId: string;
  name: string;
  companyName: string | null;
  latestDate: string | null;
  photoCount: number;
};

export async function GET(request: Request) {
  const userId = await requireUser();
  if (!userId) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const kindParam = (url.searchParams.get('kind') ?? '').trim().toLowerCase();
  const siteKind = kindParam === 'daily' ? 'DAILY' : kindParam === 'normal' ? 'NORMAL' : null;

  const groups = await prisma.storedDocument.groupBy({
    by: ['siteId'],
    where: {
      siteId: { not: null },
      kind: 'PHOTO',
      bizDateYmd: { not: null },
    },
    _max: { bizDateYmd: true },
    _count: { _all: true },
  });

  if (groups.length === 0) {
    return Response.json({ ok: true, sites: [] });
  }

  const siteIds = groups
    .map((group) => group.siteId)
    .filter((id): id is string => !!id && id.trim() !== '');
  const sites = await prisma.site.findMany({
    where: { id: { in: siteIds }, ...(siteKind ? { kind: siteKind } : {}) },
    select: { id: true, name: true, companyName: true },
  });
  const siteMap: Record<string, { name: string; companyName: string | null }> = {};
  for (const site of sites) {
    siteMap[site.id] = { name: site.name, companyName: site.companyName };
  }

  const summary = groups
    .map((group) => {
      const siteId = group.siteId;
      if (!siteId) return null;
      const site = siteMap[siteId];
      if (!site || !site.name) return null;
      return {
        siteId,
        name: site.name,
        companyName: site.companyName,
        latestDate: group._max.bizDateYmd ?? null,
        photoCount: group._count._all,
      } as SummaryItem;
    })
    .filter((item): item is SummaryItem => !!item)
    .sort((a, b) => {
      if (!a.latestDate && !b.latestDate) return 0;
      if (!a.latestDate) return 1;
      if (!b.latestDate) return -1;
      return b.latestDate.localeCompare(a.latestDate);
    });

  return Response.json({ ok: true, sites: summary });
}