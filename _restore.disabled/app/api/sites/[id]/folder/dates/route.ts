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

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requireUser();
  if (!userId) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const siteId = (id ?? '').trim();
  if (!siteId) return Response.json({ ok: false, error: 'Invalid siteId' }, { status: 400 });

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { id: true } });
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

  const map: Record<string, { dateYmd: string; photoCount: number; reportCount: number }> = {};
  for (const g of groups) {
    const dateYmd = (g.bizDateYmd ?? '').trim();
    if (!dateYmd) continue;
    const cur = (map[dateYmd] ??= { dateYmd, photoCount: 0, reportCount: 0 });
    const c = g._count._all;
    if (g.kind === 'PHOTO') cur.photoCount += c;
    if (g.kind === 'REPORT') cur.reportCount += c;
  }

  const dates = Object.values(map).sort((a, b) => (a.dateYmd < b.dateYmd ? 1 : a.dateYmd > b.dateYmd ? -1 : 0));

  return Response.json({ ok: true, siteId, dates });
}
