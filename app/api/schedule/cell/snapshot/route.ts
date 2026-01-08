import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';

const LABEL_COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
type LabelColor = (typeof LABEL_COLORS)[number];

function isLabelColor(v: unknown): v is LabelColor {
  return typeof v === 'string' && (LABEL_COLORS as readonly string[]).includes(v);
}

function startOfDayLocal(ymd: string) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
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

function colorForEntry(label: string, meta: unknown): LabelColor {
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    const c = m.labelColor;
    if (isLabelColor(c)) return c;
  }
  return label.includes('!') ? 'red' : 'default';
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = (url.searchParams.get('userId') ?? '').trim();
  const day = (url.searchParams.get('day') ?? '').trim();
  const kindParam = (url.searchParams.get('kind') ?? '').trim().toLowerCase();
  const kind = kindParam === 'daily' ? 'DAILY' : 'NORMAL';

  if (!userId) return Response.json({ ok: false, error: 'userId is required' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ ok: false, error: 'day must be YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return Response.json({ ok: false, error: 'User not found' }, { status: 404 });

    const startAt = startOfDayLocal(day);
    const until = addDays(startAt, 1);

    const existing = await prisma.workEntry.findMany({
      where: { userId, kind, startAt: { gte: startAt, lt: until } },
      orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
      take: 2,
      select: {
        note: true,
        summary: true,
        accountingMeta: true,
        site: { select: { name: true } },
      },
    });

    const slot1 = existing[0] ? labelForEntry(existing[0]) : null;
    const slot2 = existing[1] ? labelForEntry(existing[1]) : null;

    const color1: LabelColor = slot1 && existing[0] ? colorForEntry(slot1, existing[0].accountingMeta) : 'default';
    const color2: LabelColor = slot2 && existing[1] ? colorForEntry(slot2, existing[1].accountingMeta) : 'default';

    return Response.json({ ok: true, day, slots: [slot1, slot2], colors: [color1, color2] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return Response.json({ ok: false, error: msg }, { status: 503 });
  }
}
