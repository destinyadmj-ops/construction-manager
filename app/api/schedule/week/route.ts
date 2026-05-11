import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

const LABEL_COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
type LabelColor = (typeof LABEL_COLORS)[number];

function isLabelColor(v: unknown): v is LabelColor {
  return typeof v === 'string' && (LABEL_COLORS as readonly string[]).includes(v);
}

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

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function extractSiteNames(meta: unknown): string[] {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
  const m = meta as Record<string, unknown>;

  const candidates: unknown[] = [
    m.siteNames,
    m.siteName,
    m.genbaNames,
    m.genbaName,
  ];

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

  // De-duplicate while preserving order
  return Array.from(new Set(result));
}

function labelForEntry(e: {
  site: { name: string } | null;
  summary: string | null;
  note: string | null;
  accountingMeta: unknown;
}): string | null {
  const siteFromRelation = e.site?.name?.trim() ?? '';
  if (siteFromRelation) return siteFromRelation;

  const siteNames = extractSiteNames(e.accountingMeta);
  const first = (siteNames[0] ?? '').trim();
  if (first) return first;

  const fallback = (e.summary ?? e.note ?? '').toString().trim();
  return fallback || null;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function colorForEntry(input: {
  label: string;
  site: { scheduleLabelColor: string | null } | null;
  accountingMeta: unknown;
}): LabelColor {
  const meta = asObject(input.accountingMeta);
  const metaColor = meta?.labelColor;
  if (isLabelColor(metaColor)) return metaColor;

  const siteColor = (input.site?.scheduleLabelColor ?? '').trim();
  if (isLabelColor(siteColor)) return siteColor;

  return input.label.includes('!') ? 'red' : 'default';
}

function normalizeGroupKey(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLocaleLowerCase('ja-JP');
}

function formatGroupValue(group: { items: Array<{ label: string }> } | null | undefined) {
  const labels = (group?.items ?? []).map((item) => item.label.trim()).filter((label) => label.length > 0);
  return labels.length > 0 ? labels.join(' / ') : null;
}

function buildCellGroups(items: Array<{ label: string; color: LabelColor; companyName: string | null }>) {
  const groups: Array<{ key: string; items: Array<{ label: string; color: LabelColor }> }> = [];
  for (const item of items) {
    const companyKey = normalizeGroupKey(item.companyName);
    const key = companyKey ? `company:${companyKey}` : `single:${normalizeGroupKey(item.label)}`;
    const hit = groups.find((group) => group.key === key);
    if (hit) {
      hit.items.push({ label: item.label, color: item.color });
    } else {
      groups.push({ key, items: [{ label: item.label, color: item.color }] });
    }
  }
  return groups.slice(0, 2).map((group) => ({ items: group.items.slice(0, 4) }));
}

// Minimal weekly schedule API:
// - rows: User
// - columns: 7 days
// - cell: up to 2 WorkEntry notes (sorted by startAt)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const weekStartParam = (url.searchParams.get('weekStart') ?? '').trim();
  const kindParam = (url.searchParams.get('kind') ?? '').trim().toLowerCase();
  const kind = kindParam === 'daily' ? 'DAILY' : 'NORMAL';

  const weekStart = weekStartParam
    ? startOfDay(new Date(`${weekStartParam}T00:00:00`))
    : startOfDay(new Date());

  const since = weekStart;
  const until = addDays(weekStart, 7);

  const days = Array.from({ length: 7 }, (_, i) => toYmd(addDays(weekStart, i)));

  const users = await prisma.user.findMany({
    where: { kind, showInSchedule: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, email: true },
    take: 200,
  });

  const entries = await prisma.workEntry.findMany({
    where: {
      startAt: { gte: since, lt: until },
      userId: { in: users.map((u) => u.id) },
      kind,
    },
    orderBy: [{ userId: 'asc' }, { startAt: 'asc' }],
    select: {
      userId: true,
      startAt: true,
      note: true,
      summary: true,
      accountingMeta: true,
      site: { select: { name: true, companyName: true, scheduleLabelColor: true } },
    },
  });

  const grid: Record<
    string,
    Record<
      string,
      {
        slot1: string | null;
        slot2: string | null;
        color1: LabelColor;
        color2: LabelColor;
        groups?: Array<{ items: Array<{ label: string; color: LabelColor }> }>;
      }
    >
  > = {};

  for (const u of users) grid[u.id] = {};

  const cellItems: Record<string, Record<string, Array<{ label: string; color: LabelColor; companyName: string | null }>>> = {};

  for (const e of entries) {
    const day = toYmd(e.startAt);
    if (!days.includes(day)) continue;

    const label = labelForEntry(e);
    if (!label) continue;

    const color: LabelColor = colorForEntry({ label, site: e.site, accountingMeta: e.accountingMeta });
    if (!cellItems[e.userId]) cellItems[e.userId] = {};
    if (!cellItems[e.userId]![day]) cellItems[e.userId]![day] = [];
    cellItems[e.userId]![day]!.push({ label, color, companyName: e.site?.companyName ?? null });
  }

  for (const uid of Object.keys(cellItems)) {
    for (const day of Object.keys(cellItems[uid]!)) {
      const items = cellItems[uid]![day]!;
      if (items.length === 0) continue;

      const cell =
        grid[uid]![day] ??
        (grid[uid]![day] = {
          slot1: null,
          slot2: null,
          color1: 'default',
          color2: 'default',
        });

      const groups = buildCellGroups(items);
      cell.groups = groups;
      cell.slot1 = formatGroupValue(groups[0]) ?? null;
      cell.slot2 = formatGroupValue(groups[1]) ?? null;
      cell.color1 = groups[0]?.items[0]?.color ?? 'default';
      cell.color2 = groups[1]?.items[0]?.color ?? 'default';
    }
  }

  return Response.json({ ok: true, weekStart: toYmd(weekStart), days, users, grid }, { headers: NO_STORE_HEADERS });
}
