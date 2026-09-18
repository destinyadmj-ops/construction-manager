import 'dotenv/config';
import { prisma } from '../src/server/db/prisma';
import { POST as runSync } from '../app/api/sites/shared-sync/route';
import { GET as getWeek } from '../app/api/schedule/week/route';

function hasSharedMeta(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'sharedExcelSync' in value;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeNameKey(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ja-JP').trim();
}

function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfWeek(date: Date): Date {
  const value = new Date(date);
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + diff);
  value.setHours(0, 0, 0, 0);
  return value;
}

async function main() {
  const allUsers = await prisma.user.findMany({
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
    take: 1000,
  });
  const userNameById = new Map(allUsers.map((user) => [user.id, user.name ?? user.id] as const));
  const duplicateNameGroups = new Map<string, Array<{ id: string; name: string | null }>>();
  for (const user of allUsers) {
    const key = normalizeNameKey(user.name);
    if (!key) continue;
    const hit = duplicateNameGroups.get(key) ?? [];
    hit.push(user);
    duplicateNameGroups.set(key, hit);
  }

  const rows = await prisma.workEntry.findMany({
    where: { kind: 'NORMAL' },
    select: { userId: true, startAt: true, summary: true, accountingMeta: true, site: { select: { name: true } } },
    orderBy: [{ userId: 'asc' }, { startAt: 'asc' }],
    take: 5000,
  });

  const sharedBeforeRows = rows.filter((row) => hasSharedMeta(row.accountingMeta));
  const sharedCells = new Map<string, Array<{ userId: string; day: string; label: string; color: string; groupIndex: number | null }>>();
  let sampleGroupedCell:
    | { userId: string; userName: string; day: string; weekStart: string; labels: string[]; colors: string[]; groupIndexes: Array<number | null> }
    | null = null;
  let furiganaInSharedRows: { userId: string; userName: string; day: string; label: string } | null = null;
  const furiganaRegex = /[（(]\s*[ぁ-ゖァ-ヺー・･\s]+\s*[）)]/u;

  for (const row of sharedBeforeRows) {
    const day = toYmd(row.startAt);
    const meta = asObject(row.accountingMeta);
    const label = (row.site?.name ?? row.summary ?? '').trim();
    if (label && !furiganaInSharedRows && furiganaRegex.test(label)) {
      furiganaInSharedRows = {
        userId: row.userId,
        userName: userNameById.get(row.userId) ?? row.userId,
        day,
        label,
      };
    }
    const cellKey = `${row.userId}|${day}`;
    const hit = sharedCells.get(cellKey) ?? [];
    hit.push({
      userId: row.userId,
      day,
      label,
      color: typeof meta?.labelColor === 'string' ? meta.labelColor : 'default',
      groupIndex: typeof meta?.scheduleGroupIndex === 'number' ? meta.scheduleGroupIndex : null,
    });
    sharedCells.set(cellKey, hit);
  }

  for (const items of sharedCells.values()) {
    const hasDefault = items.some((item) => item.groupIndex === 0 || item.color === 'default');
    const hasRed = items.some((item) => item.groupIndex === 1 || item.color === 'red');
    if (!hasDefault || !hasRed) continue;
    const day = items[0]!.day;
    sampleGroupedCell = {
      userId: items[0]!.userId,
      userName: userNameById.get(items[0]!.userId) ?? items[0]!.userId,
      day,
      weekStart: toYmd(startOfWeek(new Date(`${day}T00:00:00`))),
      labels: items.map((item) => item.label),
      colors: items.map((item) => item.color),
      groupIndexes: items.map((item) => item.groupIndex),
    };
    break;
  }

  const weekStart = sampleGroupedCell?.weekStart ?? toYmd(startOfWeek(sharedBeforeRows.length > 0 ? sharedBeforeRows[sharedBeforeRows.length - 1]!.startAt : new Date()));

  const syncBody = JSON.stringify({ kind: 'NORMAL', targetTerm: null });
  const syncRes = await runSync(
    new Request('http://localhost/api/sites/shared-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: syncBody,
    }),
  );
  const syncJson = await syncRes.json();

  const rowsAfter = await prisma.workEntry.findMany({
    where: { kind: 'NORMAL' },
    select: { userId: true, startAt: true, accountingMeta: true },
    orderBy: { startAt: 'asc' },
    take: 5000,
  });
  const sharedAfterRows = rowsAfter.filter((row) => hasSharedMeta(row.accountingMeta));

  const weekRes = await getWeek(new Request(`http://localhost/api/schedule/week?weekStart=${weekStart}&kind=normal`));
  const weekJson = await weekRes.json();
  const users: unknown[] = Array.isArray(weekJson.users) ? weekJson.users : [];
  const grid = weekJson.grid && typeof weekJson.grid === 'object' ? weekJson.grid : {};
  const saitoUsers = users.filter(
    (user): user is { id: string; name: string | null } => typeof (user as { id?: unknown })?.id === 'string' && typeof (user as { name?: unknown })?.name === 'string' && (user as { name: string }).name.includes('斎藤忠夫'),
  );

  let groupedSample: {
    user: string;
    day: string;
    colors: string[];
    labels: string[][];
  } | null = null;
  let furiganaHit: { user: string; day: string; label: string } | null = null;
  let routeGroupedCell: unknown = null;
  if (sampleGroupedCell) {
    const sampleGrid = grid[sampleGroupedCell.userId] && typeof grid[sampleGroupedCell.userId] === 'object'
      ? (grid[sampleGroupedCell.userId] as Record<string, unknown>)
      : {};
    routeGroupedCell = sampleGrid[sampleGroupedCell.day] ?? null;
  }

  for (const user of users as Array<{ id?: unknown; name?: unknown }>) {
    const userId = typeof user?.id === 'string' ? user.id : '';
    if (!userId) continue;
    const byDay = grid[userId] && typeof grid[userId] === 'object' ? (grid[userId] as Record<string, unknown>) : {};
    for (const [day, cellRaw] of Object.entries(byDay)) {
      const cell = cellRaw && typeof cellRaw === 'object' ? (cellRaw as Record<string, unknown>) : null;
      const groups = Array.isArray(cell?.groups) ? cell.groups : [];
      if (!groupedSample && groups.length >= 2) {
        const colors = groups.map((group) => {
          const items = group && typeof group === 'object' && Array.isArray((group as { items?: unknown[] }).items)
            ? ((group as { items: Array<{ color?: string }> }).items)
            : [];
          return items[0]?.color ?? 'default';
        });
        if (colors[0] === 'default' && colors[1] === 'red') {
          groupedSample = {
            user: typeof user?.name === 'string' ? user.name : userId,
            day,
            colors,
            labels: groups.map((group) => {
              const items = group && typeof group === 'object' && Array.isArray((group as { items?: unknown[] }).items)
                ? ((group as { items: Array<{ label?: string }> }).items)
                : [];
              return items.map((item) => item.label ?? '').filter((label) => label.length > 0);
            }),
          };
        }
      }
      for (const group of groups) {
        const items = group && typeof group === 'object' && Array.isArray((group as { items?: unknown[] }).items)
          ? ((group as { items: Array<{ label?: string }> }).items)
          : [];
        for (const item of items) {
          if (typeof item.label === 'string' && furiganaRegex.test(item.label)) {
            furiganaHit = {
              user: typeof user?.name === 'string' ? user.name : userId,
              day,
              label: item.label,
            };
            break;
          }
        }
        if (furiganaHit) break;
      }
      if (furiganaHit && groupedSample) break;
    }
    if (furiganaHit && groupedSample) break;
  }

  console.log(
    JSON.stringify(
      {
        syncStatus: syncRes.status,
        syncCounts: syncJson && typeof syncJson === 'object' ? (syncJson as { counts?: unknown }).counts ?? null : null,
        syncWarnings: syncJson && typeof syncJson === 'object' ? (syncJson as { warnings?: unknown }).warnings ?? null : null,
        sharedBefore: sharedBeforeRows.length,
        sharedAfter: sharedAfterRows.length,
        sharedDelta: sharedAfterRows.length - sharedBeforeRows.length,
        weekStart,
        weekStatus: weekRes.status,
        duplicateNameGroups: Array.from(duplicateNameGroups.values())
          .filter((group) => group.length > 1)
          .map((group) => ({ name: group[0]?.name ?? null, ids: group.map((user) => user.id) }))
          .slice(0, 20),
        saitoUsers,
        saitoCount: saitoUsers.length,
        sampleGroupedCell,
        groupedSample,
        routeGroupedCell,
        furiganaHit,
        furiganaInSharedRows,
      },
      null,
      2,
    ),
  );
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });