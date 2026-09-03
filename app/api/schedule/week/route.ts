import { hasSiteFamilyDisplayPrefix, normalizeSiteFamilyKey, findSiteFamily } from '@/shared/site-family';
import {
  cloneScheduleSyncSource,
  isScheduleSyncSource,
  type ScheduleSyncSource,
} from '@/shared/schedule-sync-source';
import {
  formatScheduleCellGroupDisplayValue,
  isScheduleCellEntryKind,
  normalizeScheduleCellNote,
  normalizeScheduleCellEntryKind,
  type ScheduleCellEntryKind,
} from '@/shared/schedule-cell-entry';
import { prisma } from '@/server/db/prisma';
import { applyGlobalScheduleUserOrder } from '@/server/schedule-user-order';

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

function extractManualText(meta: unknown): string {
  const m = asObject(meta);
  return typeof m?.scheduleText === 'string' ? m.scheduleText.trim() : '';
}

function extractGroupNote(meta: unknown): string | null {
  const m = asObject(meta);
  return normalizeScheduleCellNote(m?.scheduleGroupNote);
}

function entryKindForEntry(site: { name: string } | null, accountingMeta: unknown): ScheduleCellEntryKind {
  const meta = asObject(accountingMeta);
  return normalizeScheduleCellEntryKind(meta?.scheduleEntryKind ?? (site ? 'site' : 'note'));
}

function labelForEntry(e: {
  site: { name: string } | null;
  summary: string | null;
  note: string | null;
  accountingMeta: unknown;
}): string | null {
  const kind = entryKindForEntry(e.site, e.accountingMeta);
  if (kind === 'note') {
    const manualText = extractManualText(e.accountingMeta);
    const fallback = (e.summary ?? e.note ?? '').toString().trim();
    return manualText || fallback || null;
  }

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

function syncSourceForEntry(accountingMeta: unknown): ScheduleSyncSource | null {
  const meta = asObject(accountingMeta);
  return isScheduleSyncSource(meta?.scheduleSyncSource) ? cloneScheduleSyncSource(meta?.scheduleSyncSource) : null;
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

function formatGroupValue(group: { items: Array<{ label: string }>; note?: string | null } | null | undefined) {
  const labels = (group?.items ?? []).map((item) => item.label.trim()).filter((label) => label.length > 0);
  return formatScheduleCellGroupDisplayValue(labels, group?.note);
}

function buildCellGroups(items: Array<{ label: string; color: LabelColor; kind: ScheduleCellEntryKind; groupIndex?: number | null; itemIndex?: number | null; syncSource?: ScheduleSyncSource | null; groupNote?: string | null; legacyNoteText?: string | null }>) {
  if (items.length > 0 && items.every((item) => typeof item.groupIndex === 'number')) {
    const grouped = new Map<
      number,
      {
        items: Array<{ label: string; color: LabelColor; kind: ScheduleCellEntryKind; order: number; syncSource: ScheduleSyncSource | null }>;
        note: string | null;
        fallbackNoteItem: { label: string; color: LabelColor } | null;
      }
    >();
    items.forEach((item, itemOrder) => {
      const groupIndex = item.groupIndex as number;
      if (groupIndex < 0 || groupIndex > 3) return;
      const hit = grouped.get(groupIndex) ?? { items: [], note: null, fallbackNoteItem: null };
      if (item.groupNote && !hit.note) hit.note = item.groupNote;
      if (item.kind === 'note') {
        const noteText = item.legacyNoteText ?? normalizeScheduleCellNote(item.label);
        if (noteText && !hit.note) hit.note = noteText;
        if (noteText && !hit.fallbackNoteItem) hit.fallbackNoteItem = { label: noteText, color: item.color };
        grouped.set(groupIndex, hit);
        return;
      }
      hit.items.push({
        label: item.label,
        color: item.color,
        kind: item.kind,
        order: typeof item.itemIndex === 'number' ? item.itemIndex : itemOrder,
        syncSource: cloneScheduleSyncSource(item.syncSource),
      });
      grouped.set(groupIndex, hit);
    });

    return Array.from(grouped.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([, group]) => {
        const groupItems = [...group.items]
          .sort((left, right) => left.order - right.order)
          .slice(0, 4)
          .map(({ label, color, kind, syncSource }) => ({ label, color, kind, syncSource }));
        if (groupItems.length > 0) return { items: groupItems, note: group.note };
        if (!group.fallbackNoteItem) return null;
        return {
          items: [{ label: group.fallbackNoteItem.label, color: group.fallbackNoteItem.color, kind: 'note' as const, syncSource: null }],
          note: null,
        };
      })
      .filter((group): group is { items: Array<{ label: string; color: LabelColor; kind: ScheduleCellEntryKind; syncSource: ScheduleSyncSource | null }>; note: string | null } => !!group)
      .slice(0, 4);
  }

  const groups: Array<{ key: string; items: Array<{ label: string; color: LabelColor; kind: ScheduleCellEntryKind; syncSource: ScheduleSyncSource | null }>; note: string | null }> = [];
  const peerNames = items.filter((item) => item.kind === 'site').map((item) => item.label);
  for (const item of items) {
    if (item.kind === 'note') {
      const noteText = item.legacyNoteText ?? normalizeScheduleCellNote(item.label);
      const lastSiteGroup = [...groups].reverse().find((group) => group.items.some((groupItem) => groupItem.kind === 'site'));
      if (lastSiteGroup && noteText && !lastSiteGroup.note) {
        lastSiteGroup.note = noteText;
        continue;
      }
      groups.push({ key: `note:${groups.length}`, items: [{ label: noteText ?? item.label, color: item.color, kind: item.kind, syncSource: null }], note: null });
      continue;
    }

    const family = findSiteFamily(item.label, peerNames);
    const explicitPrefix = hasSiteFamilyDisplayPrefix(item.label);
    const key = family.key
      ? `${explicitPrefix ? 'prefixed-family' : 'family'}:${family.key}`
      : `${explicitPrefix ? 'prefixed-single' : 'single'}:${normalizeSiteFamilyKey(item.label)}`;
    const hit = groups.find((group) => group.key === key);
    if (hit) {
      hit.items.push({ label: item.label, color: item.color, kind: item.kind, syncSource: cloneScheduleSyncSource(item.syncSource) });
      if (item.groupNote && !hit.note) hit.note = item.groupNote;
    } else {
      groups.push({ key, items: [{ label: item.label, color: item.color, kind: item.kind, syncSource: cloneScheduleSyncSource(item.syncSource) }], note: item.groupNote ?? null });
    }
  }
  return groups.slice(0, 4).map((group) => ({ items: group.items.slice(0, 4), note: group.note }));
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

  const usersRaw = await prisma.user.findMany({
    where: { kind, showInSchedule: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, email: true },
    take: 200,
  });
  const users = await applyGlobalScheduleUserOrder(kind, usersRaw);

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
        groups?: Array<{ items: Array<{ label: string; color: LabelColor; kind?: ScheduleCellEntryKind; syncSource?: ScheduleSyncSource | null }>; note?: string | null }>;
      }
    >
  > = {};

  for (const u of users) grid[u.id] = {};

  const cellItems: Record<string, Record<string, Array<{ label: string; color: LabelColor; kind: ScheduleCellEntryKind; groupIndex?: number | null; itemIndex?: number | null; syncSource?: ScheduleSyncSource | null; groupNote?: string | null; legacyNoteText?: string | null }>>> = {};

  for (const e of entries) {
    const day = toYmd(e.startAt);
    if (!days.includes(day)) continue;

    const label = labelForEntry(e);
    if (!label) continue;

    const color: LabelColor = colorForEntry({ label, site: e.site, accountingMeta: e.accountingMeta });
    if (!cellItems[e.userId]) cellItems[e.userId] = {};
    if (!cellItems[e.userId]![day]) cellItems[e.userId]![day] = [];
    const meta = e.accountingMeta && typeof e.accountingMeta === 'object' && !Array.isArray(e.accountingMeta)
      ? (e.accountingMeta as Record<string, unknown>)
      : null;
    const groupIndex = typeof meta?.scheduleGroupIndex === 'number' ? meta.scheduleGroupIndex : null;
    const itemIndex = typeof meta?.scheduleItemIndex === 'number' ? meta.scheduleItemIndex : null;
    const itemKind = isScheduleCellEntryKind(meta?.scheduleEntryKind)
      ? meta.scheduleEntryKind
      : entryKindForEntry(e.site, e.accountingMeta);
    cellItems[e.userId]![day]!.push({
      label,
      color,
      kind: itemKind,
      groupIndex,
      itemIndex,
      syncSource: syncSourceForEntry(e.accountingMeta),
      groupNote: extractGroupNote(e.accountingMeta),
      legacyNoteText: itemKind === 'note' ? normalizeScheduleCellNote(extractManualText(e.accountingMeta) || label) : null,
    });
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
