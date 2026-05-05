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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const monthParam = (url.searchParams.get('month') ?? '').trim();
  const kindParam = (url.searchParams.get('kind') ?? '').trim().toLowerCase();
  const kind = kindParam === 'daily' ? 'DAILY' : 'NORMAL';

  // month: YYYY-MM
  const m = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : '';
  const base = m ? new Date(`${m}-01T00:00:00`) : new Date();

  const since = startOfDay(new Date(base.getFullYear(), base.getMonth(), 1));
  const until = startOfDay(new Date(base.getFullYear(), base.getMonth() + 1, 1));

  const dim = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: dim }, (_, i) => toYmd(addDays(since, i)));

  const users = await prisma.user.findMany({
    where: { kind },
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
      site: { select: { name: true, scheduleLabelColor: true } },
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
      }
    >
  > = {};

  for (const u of users) grid[u.id] = {};

  const cellItems: Record<string, Record<string, Array<{ label: string; color: LabelColor }>>> = {};

  for (const e of entries) {
    const day = toYmd(e.startAt);
    if (!days.includes(day)) continue;

    const label = labelForEntry(e);
    if (!label) continue;

    const color: LabelColor = colorForEntry({ label, site: e.site, accountingMeta: e.accountingMeta });
    if (!cellItems[e.userId]) cellItems[e.userId] = {};
    if (!cellItems[e.userId]![day]) cellItems[e.userId]![day] = [];
    cellItems[e.userId]![day]!.push({ label, color });
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

      cell.slot1 = items[0]!.label;
      cell.color1 = items[0]!.color;

      if (items.length >= 2) {
        const extra = items.length - 2;
        cell.slot2 = extra > 0 ? `${items[1]!.label} +${extra}` : items[1]!.label;
        cell.color2 = items[1]!.color;
      } else {
        cell.slot2 = null;
        cell.color2 = 'default';
      }
    }
  }

  return Response.json(
    { ok: true, month: `${base.getFullYear()}-${pad2(base.getMonth() + 1)}`, days, users, grid },
    { headers: NO_STORE_HEADERS },
  );
}
