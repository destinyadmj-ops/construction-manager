import { prisma } from '@/server/db/prisma';
import { listSiteDayFolders, ymdInTokyo } from '@/server/site-storage';
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

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requireUser();
  if (!userId) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const scope = (url.searchParams.get('scope') ?? '').trim().toLowerCase();
  const includeHistory = scope === 'history';

  const { id } = await ctx.params;
  const siteId = (id ?? '').trim();
  if (!siteId) return Response.json({ ok: false, error: 'Invalid siteId' }, { status: 400 });

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { id: true, name: true } });
  if (!site) return Response.json({ ok: false, error: 'Site not found' }, { status: 404 });

  const groups = await prisma.storedDocument.groupBy({
    by: ['bizDateYmd', 'kind'],
    where: {
      siteId,
      bizDateYmd: { not: null },
      kind: { in: ['PHOTO', 'REPORT'] },
    },
    _count: { _all: true },
    orderBy: { bizDateYmd: 'desc' },
    take: 366,
  });

  const map: Record<string, { dateYmd: string; photoCount: number; reportCount: number; scheduleCount: number }> = {};
  for (const g of groups) {
    const dateYmd = (g.bizDateYmd ?? '').trim();
    if (!dateYmd) continue;
    const cur = (map[dateYmd] ??= { dateYmd, photoCount: 0, reportCount: 0, scheduleCount: 0 });
    const c = g._count._all;
    if (g.kind === 'PHOTO') cur.photoCount += c;
    if (g.kind === 'REPORT') cur.reportCount += c;
  }

  if (includeHistory) {
    const folderDates = await listSiteDayFolders(siteId, site.name, 366);
    for (const dateYmd of folderDates) {
      map[dateYmd] ??= { dateYmd, photoCount: 0, reportCount: 0, scheduleCount: 0 };
    }

    const workEntries = await prisma.workEntry.findMany({
      where: { siteId },
      orderBy: { startAt: 'desc' },
      take: 1500,
      select: { startAt: true },
    });
    for (const entry of workEntries) {
      const dateYmd = ymdInTokyo(entry.startAt);
      const cur = (map[dateYmd] ??= { dateYmd, photoCount: 0, reportCount: 0, scheduleCount: 0 });
      cur.scheduleCount += 1;
    }
  }

  const dates = Object.values(map)
    .sort((a, b) => (a.dateYmd < b.dateYmd ? 1 : a.dateYmd > b.dateYmd ? -1 : 0))
    .slice(0, 366);

  return Response.json({ ok: true, siteId, dates });
}
