import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const yearParam = (url.searchParams.get('year') ?? '').trim();
  const year = /^\d{4}$/.test(yearParam) ? Number(yearParam) : new Date().getFullYear();

  const since = startOfDay(new Date(year, 0, 1));
  const until = startOfDay(new Date(year + 1, 0, 1));

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${pad2(i + 1)}`);

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, email: true },
    take: 200,
  });

  const userIds = users.map((u) => u.id);

  const entries = await prisma.workEntry.findMany({
    where: {
      startAt: { gte: since, lt: until },
      userId: { in: userIds },
    },
    select: { userId: true, startAt: true },
    orderBy: [{ userId: 'asc' }, { startAt: 'asc' }],
  });

  const grid: Record<string, Record<string, { entries: number; days: number }>> = {};

  // Pre-init so UI can render stable grid.
  for (const uid of userIds) {
    grid[uid] = {};
    for (const m of months) grid[uid][m] = { entries: 0, days: 0 };
  }

  const daySets: Record<string, Record<string, Set<string>>> = {};

  for (const e of entries) {
    const m = `${e.startAt.getFullYear()}-${pad2(e.startAt.getMonth() + 1)}`;
    const uid = e.userId;
    if (!grid[uid] || !grid[uid][m]) continue;

    grid[uid][m].entries += 1;

    const ymd = toYmd(e.startAt);
    if (!daySets[uid]) daySets[uid] = {};
    if (!daySets[uid][m]) daySets[uid][m] = new Set<string>();
    daySets[uid][m].add(ymd);
  }

  for (const uid of userIds) {
    for (const m of months) {
      grid[uid][m].days = daySets[uid]?.[m]?.size ?? 0;
    }
  }

  return Response.json({ ok: true, year, months, users, grid });
}
