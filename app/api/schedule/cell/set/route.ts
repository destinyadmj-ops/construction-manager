import { prisma } from '@/server/db/prisma';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import {
  createScheduleCellSnapshot,
  recordScheduleChangeHistory,
} from '@/server/schedule/change-history';
import { findMatchingSite, normalizeRegistryText } from '@/server/site-registry';
import { ensureSiteDayFolders } from '@/server/site-storage';
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
import { findSiteFamily, hasSiteFamilyDisplayPrefix, normalizeSiteFamilyKey } from '@/shared/site-family';
import { z } from 'zod';

export const runtime = 'nodejs';

const LabelColorSchema = z.enum(['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']);
const ScheduleSyncSourceSchema = z.custom<ScheduleSyncSource>((value) => isScheduleSyncSource(value), {
  message: 'Invalid sync source',
});
const CellGroupItemSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    color: LabelColorSchema.optional().nullable(),
    kind: z.custom<ScheduleCellEntryKind>((value) => isScheduleCellEntryKind(value), {
      message: 'Invalid entry kind',
    }).optional().nullable(),
    syncSource: ScheduleSyncSourceSchema.optional().nullable(),
  })
  .strict();

const CellGroupSchema = z
  .object({
    items: z.array(CellGroupItemSchema).min(1).max(4),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

const BodySchema = z
  .object({
    userId: z.string().min(1),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
    slot1: z.string().trim().max(200).nullable().optional(),
    slot2: z.string().trim().max(200).nullable().optional(),
    slot1Color: LabelColorSchema.optional().nullable(),
    slot2Color: LabelColorSchema.optional().nullable(),
    groups: z.array(CellGroupSchema).max(4).optional().nullable(),
  })
  .strict();

  type LabelColor = z.infer<typeof LabelColorSchema>;
  type NormalizedGroupItem = {
    label: string;
    color: LabelColor;
    kind: ScheduleCellEntryKind;
    syncSource: ScheduleSyncSource | null;
  };
  type NormalizedGroup = { items: NormalizedGroupItem[]; note: string | null };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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

function addMinutes(d: Date, minutes: number) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() + minutes);
  return x;
}

function buildSnapshotFromGroups(groups: NormalizedGroup[]) {
  return createScheduleCellSnapshot({
    slot1: groups[0] ? formatScheduleCellGroupDisplayValue(groups[0].items.map((item) => item.label), groups[0].note) : null,
    slot1Color: groups[0]?.items[0]?.color ?? 'default',
    slot2: groups[1] ? formatScheduleCellGroupDisplayValue(groups[1].items.map((item) => item.label), groups[1].note) : null,
    slot2Color: groups[1]?.items[0]?.color ?? 'default',
    slot3: groups[2] ? formatScheduleCellGroupDisplayValue(groups[2].items.map((item) => item.label), groups[2].note) : null,
    slot3Color: groups[2]?.items[0]?.color ?? 'default',
    slot4: groups[3] ? formatScheduleCellGroupDisplayValue(groups[3].items.map((item) => item.label), groups[3].note) : null,
    slot4Color: groups[3]?.items[0]?.color ?? 'default',
  });
}

function buildGroupsFromEntries(
  entries: Array<{
    summary: string | null;
    accountingMeta: unknown;
    site: { name: string; companyName: string | null } | null;
  }>,
): NormalizedGroup[] {
  const items = entries
    .map((entry, entryOrder) => {
      const label =
        typeof entry.site?.name === 'string' && entry.site.name.trim()
          ? entry.site.name.trim()
          : typeof entry.summary === 'string'
            ? entry.summary.trim()
            : '';
      if (!label) return null;

      const meta = asObject(entry.accountingMeta);
      const color = LabelColorSchema.safeParse(meta?.labelColor).success
        ? (meta?.labelColor as LabelColor)
        : 'default';
      const kind = normalizeScheduleCellEntryKind(meta?.scheduleEntryKind ?? (entry.site ? 'site' : 'note'));
      const syncSource = isScheduleSyncSource(meta?.scheduleSyncSource)
        ? cloneScheduleSyncSource(meta.scheduleSyncSource)
        : null;
      const groupIndex = typeof meta?.scheduleGroupIndex === 'number' ? meta.scheduleGroupIndex : null;
      const itemIndex = typeof meta?.scheduleItemIndex === 'number' ? meta.scheduleItemIndex : null;
      const groupNote = normalizeScheduleCellNote(meta?.scheduleGroupNote);
      const legacyNoteText = kind === 'note'
        ? normalizeScheduleCellNote(typeof meta?.scheduleText === 'string' ? meta.scheduleText : label)
        : null;
      return { label, color, kind, syncSource, groupIndex, itemIndex, entryOrder, groupNote, legacyNoteText };
    })
    .filter((item): item is NormalizedGroupItem & { groupIndex: number | null; itemIndex: number | null; entryOrder: number; groupNote: string | null; legacyNoteText: string | null } => !!item);

  if (items.length > 0 && items.every((item) => typeof item.groupIndex === 'number')) {
    const grouped = new Map<
      number,
      {
        items: Array<{ label: string; color: LabelColor; kind: ScheduleCellEntryKind; syncSource: ScheduleSyncSource | null; order: number }>;
        note: string | null;
        fallbackNoteItem: { label: string; color: LabelColor } | null;
      }
    >();
    for (const item of items) {
      const groupIndex = item.groupIndex as number;
      if (groupIndex < 0 || groupIndex > 3) continue;
      const hit = grouped.get(groupIndex) ?? { items: [], note: null, fallbackNoteItem: null };
      if (item.groupNote && !hit.note) hit.note = item.groupNote;
      if (item.kind === 'note') {
        const noteText = item.legacyNoteText ?? normalizeScheduleCellNote(item.label);
        if (noteText && !hit.note) hit.note = noteText;
        if (noteText && !hit.fallbackNoteItem) hit.fallbackNoteItem = { label: noteText, color: item.color };
        grouped.set(groupIndex, hit);
        continue;
      }
      hit.items.push({
        label: item.label,
        color: item.color,
        kind: item.kind,
        syncSource: item.syncSource,
        order: typeof item.itemIndex === 'number' ? item.itemIndex : item.entryOrder,
      });
      grouped.set(groupIndex, hit);
    }

    return Array.from(grouped.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([, group]) => {
        const groupItems = [...group.items]
          .sort((left, right) => left.order - right.order)
          .slice(0, 4)
          .map(({ label, color, kind, syncSource }) => ({ label, color, kind, syncSource }));
        if (groupItems.length > 0) {
          return { items: groupItems, note: group.note };
        }
        if (!group.fallbackNoteItem) return null;
        return {
          items: [{
            label: group.fallbackNoteItem.label,
            color: group.fallbackNoteItem.color,
            kind: 'note' as const,
            syncSource: null,
          }],
          note: null,
        };
      })
      .filter((group): group is NormalizedGroup => !!group)
      .slice(0, 4);
  }

  const groups: Array<{ key: string; items: NormalizedGroupItem[]; note: string | null }> = [];
  const peerNames = items.filter((item) => item.kind === 'site').map((item) => item.label);
  for (const item of items) {
    if (item.kind === 'note') {
      const noteText = item.legacyNoteText ?? normalizeScheduleCellNote(item.label);
      const lastSiteGroup = [...groups].reverse().find((group) => group.items.some((groupItem) => groupItem.kind === 'site'));
      if (lastSiteGroup && noteText && !lastSiteGroup.note) {
        lastSiteGroup.note = noteText;
        continue;
      }
      groups.push({
        key: `note:${item.entryOrder}`,
        items: [{ label: noteText ?? item.label, color: item.color, kind: 'note', syncSource: null }],
        note: null,
      });
      continue;
    }

    const family = findSiteFamily(item.label, peerNames);
    const explicitPrefix = hasSiteFamilyDisplayPrefix(item.label);
    const key = family.key
      ? `${explicitPrefix ? 'prefixed-family' : 'family'}:${family.key}`
      : `${explicitPrefix ? 'prefixed-single' : 'single'}:${normalizeSiteFamilyKey(item.label)}`;
    const hit = groups.find((group) => group.key === key);
    if (hit) {
      hit.items.push(item);
      if (item.groupNote && !hit.note) hit.note = item.groupNote;
    } else {
      groups.push({ key, items: [item], note: item.groupNote });
    }
  }
  return groups.slice(0, 4).map((group) => ({ items: group.items.slice(0, 4), note: group.note }));
}

function groupsFromLegacySlots(input: {
  slot1Name: string | null;
  slot2Name: string | null;
  slot1Color: LabelColor;
  slot2Color: LabelColor;
}): NormalizedGroup[] {
  const groups: NormalizedGroup[] = [];
  if (input.slot1Name) groups.push({ items: [{ label: input.slot1Name, color: input.slot1Color, kind: 'site', syncSource: null }], note: null });
  if (input.slot2Name) groups.push({ items: [{ label: input.slot2Name, color: input.slot2Color, kind: 'site', syncSource: null }], note: null });
  return groups;
}

async function resolveSiteByName(
  siteName: string,
  kind: 'NORMAL' | 'DAILY',
): Promise<{ id: string; name: string } | null> {
  const name = normalizeRegistryText(siteName);
  if (!name) return null;

  const found = await findMatchingSite({ companyName: null, name, kind });
  if (found.site) return { id: found.site.id, name: found.site.name };

  const created = await prisma.site.create({ data: { name, kind }, select: { id: true, name: true } });
  return created;
}

export async function POST(request: Request) {
  const authError = await requireScheduleEditor(request);
  if (authError) return authError;

  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const { userId, day } = parsed.data;
  const kind = parsed.data.kind ?? 'NORMAL';

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } });
    if (!user) return Response.json({ ok: false, error: 'User not found' }, { status: 404 });

    const startAt = startOfDayLocal(day);
    const until = addDays(startAt, 1);
    const targetUserLabel = user.name ?? user.email ?? user.id;

    const beforeEntries = await prisma.workEntry.findMany({
      where: { userId, kind, startAt: { gte: startAt, lt: until } },
      orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
      select: { summary: true, accountingMeta: true, site: { select: { name: true, companyName: true } } },
    });
    const beforeGroups = buildGroupsFromEntries(beforeEntries);
    const beforeSnapshot = buildSnapshotFromGroups(beforeGroups);

    const slot1Name = (parsed.data.slot1 ?? null)?.trim() || null;
    const slot2Name = (parsed.data.slot2 ?? null)?.trim() || null;
    const slot1Color = parsed.data.slot1Color ?? 'default';
    const slot2Color = parsed.data.slot2Color ?? 'default';

    const normalizedGroups = parsed.data.groups
      ? parsed.data.groups
          .map((group) => ({
            items: group.items
              .map((item) => ({
                label: item.label.trim(),
                color: item.color ?? 'default',
                kind: normalizeScheduleCellEntryKind(item.kind),
                syncSource: cloneScheduleSyncSource(item.syncSource),
              }))
              .filter((item) => item.label.length > 0),
              note: normalizeScheduleCellNote(group.note),
          }))
          .filter((group) => group.items.length > 0)
      : groupsFromLegacySlots({ slot1Name, slot2Name, slot1Color, slot2Color });

    if (normalizedGroups.length > 4) {
      return Response.json({ ok: false, error: '最大4枠までです' }, { status: 400 });
    }
    if (normalizedGroups.some((group) => group.items.length > 4)) {
      return Response.json({ ok: false, error: '同名別店舗は1枠4件までです' }, { status: 400 });
    }

    const resolvedGroups = await Promise.all(
      normalizedGroups.map(async (group) => {
        let groupNote = group.note;
        const items = await Promise.all(
          group.items.map(async (item) => {
            if (item.kind === 'note') {
              groupNote ||= normalizeScheduleCellNote(item.label);
              return null;
            }
            const site = await resolveSiteByName(item.label, kind);
            return site ? { kind: 'site' as const, site, label: site.name, color: item.color, syncSource: item.syncSource } : null;
          }),
        );
        return { note: groupNote, items };
      }),
    );

    const finalGroups: Array<{
      note: string | null;
      items: Array<{ kind: 'site'; site: { id: string; name: string }; label: string; color: LabelColor; syncSource: ScheduleSyncSource | null }>;
    }> = resolvedGroups.map((group) => ({
      note: group.note,
      items: group.items.filter(
        (
          item,
        ): item is { kind: 'site'; site: { id: string; name: string }; label: string; color: LabelColor; syncSource: ScheduleSyncSource | null } => !!item,
      ),
    })).filter((group) => group.items.length > 0);

    await prisma.$transaction(async (tx) => {
      await tx.workEntry.deleteMany({ where: { userId, kind, startAt: { gte: startAt, lt: until } } });

      let minuteOffset = 0;
      for (const [groupIndex, group] of finalGroups.entries()) {
        for (const [itemIndex, item] of group.items.entries()) {
          await tx.workEntry.create({
            data: {
              userId,
              kind,
              startAt: addMinutes(startAt, minuteOffset),
              summary: item.label,
              note: null,
              siteId: item.site.id,
              accountingMeta: {
                siteName: item.site.name,
                labelColor: item.color,
                scheduleGroupIndex: groupIndex,
                scheduleItemIndex: itemIndex,
                ...(group.note ? { scheduleGroupNote: group.note } : {}),
                ...(item.syncSource ? { scheduleSyncSource: item.syncSource } : {}),
              },
            },
            select: { id: true },
          });
          minuteOffset += 1;
        }
      }
    });

    try {
      for (const group of finalGroups) {
        for (const item of group.items) {
          await ensureSiteDayFolders({ siteId: item.site.id, siteName: item.site.name, dayYmd: day });
        }
      }
    } catch {
      // ignore history folder creation failure
    }

    await recordScheduleChangeHistory({
      request,
      kind,
      targetUserId: user.id,
      targetUserLabel,
      dayYmd: day,
      targetLabel: 'スケジュール',
      before: beforeSnapshot,
      beforeGroups,
      after: buildSnapshotFromGroups(
        finalGroups.map((group) => ({
          items: group.items.map((item) => ({ label: item.label, color: item.color, kind: item.kind, syncSource: item.syncSource })),
          note: group.note,
        })),
      ),
      afterGroups: finalGroups.map((group) => ({
        items: group.items.map((item) => ({ label: item.label, color: item.color, kind: item.kind })),
        note: group.note,
      })),
    });

    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return Response.json({ ok: false, error: msg }, { status: 503 });
  }
}
