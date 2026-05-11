import { prisma } from '@/server/db/prisma';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import {
  createScheduleCellSnapshot,
  recordScheduleChangeHistory,
} from '@/server/schedule/change-history';
import { findMatchingSite, normalizeRegistryText } from '@/server/site-registry';
import { ensureSiteDayFolders } from '@/server/site-storage';
import { findSiteFamily, hasSiteFamilyDisplayPrefix, normalizeSiteFamilyKey } from '@/shared/site-family';
import { z } from 'zod';

export const runtime = 'nodejs';

const LabelColorSchema = z.enum(['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']);
const CellGroupItemSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    color: LabelColorSchema.optional().nullable(),
  })
  .strict();

const CellGroupSchema = z
  .object({
    items: z.array(CellGroupItemSchema).min(1).max(4),
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
    groups: z.array(CellGroupSchema).max(2).optional().nullable(),
  })
  .strict();

  type LabelColor = z.infer<typeof LabelColorSchema>;
  type NormalizedGroupItem = { label: string; color: LabelColor };
  type NormalizedGroup = { items: NormalizedGroupItem[] };

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
    slot1: groups[0] ? groups[0].items.map((item) => item.label).join(' / ') : null,
    slot1Color: groups[0]?.items[0]?.color ?? 'default',
    slot2: groups[1] ? groups[1].items.map((item) => item.label).join(' / ') : null,
    slot2Color: groups[1]?.items[0]?.color ?? 'default',
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

      const meta = entry.accountingMeta && typeof entry.accountingMeta === 'object' && !Array.isArray(entry.accountingMeta)
        ? (entry.accountingMeta as Record<string, unknown>)
        : null;
      const color = LabelColorSchema.safeParse(meta?.labelColor).success
        ? (meta?.labelColor as LabelColor)
        : 'default';
      const groupIndex = typeof meta?.scheduleGroupIndex === 'number' ? meta.scheduleGroupIndex : null;
      const itemIndex = typeof meta?.scheduleItemIndex === 'number' ? meta.scheduleItemIndex : null;
      return { label, color, groupIndex, itemIndex, entryOrder };
    })
    .filter((item): item is NormalizedGroupItem & { groupIndex: number | null; itemIndex: number | null; entryOrder: number } => !!item);

  if (items.length > 0 && items.every((item) => typeof item.groupIndex === 'number')) {
    const grouped = new Map<number, Array<{ label: string; color: LabelColor; order: number }>>();
    for (const item of items) {
      const groupIndex = item.groupIndex as number;
      if (groupIndex < 0 || groupIndex > 1) continue;
      const hit = grouped.get(groupIndex) ?? [];
      hit.push({
        label: item.label,
        color: item.color,
        order: typeof item.itemIndex === 'number' ? item.itemIndex : item.entryOrder,
      });
      grouped.set(groupIndex, hit);
    }

    return Array.from(grouped.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([, groupItems]) => ({
        items: [...groupItems]
          .sort((left, right) => left.order - right.order)
          .slice(0, 4)
          .map(({ label, color }) => ({ label, color })),
      }))
      .slice(0, 2);
  }

  const groups: Array<{ key: string; items: NormalizedGroupItem[] }> = [];
  const peerNames = items.map((item) => item.label);
  for (const item of items) {
    const family = findSiteFamily(item.label, peerNames);
    const explicitPrefix = hasSiteFamilyDisplayPrefix(item.label);
    const key = family.key
      ? `${explicitPrefix ? 'prefixed-family' : 'family'}:${family.key}`
      : `${explicitPrefix ? 'prefixed-single' : 'single'}:${normalizeSiteFamilyKey(item.label)}`;
    const hit = groups.find((group) => group.key === key);
    if (hit) {
      hit.items.push(item);
    } else {
      groups.push({ key, items: [item] });
    }
  }
  return groups.slice(0, 2).map((group) => ({ items: group.items.slice(0, 4) }));
}

function groupsFromLegacySlots(input: {
  slot1Name: string | null;
  slot2Name: string | null;
  slot1Color: LabelColor;
  slot2Color: LabelColor;
}): NormalizedGroup[] {
  const groups: NormalizedGroup[] = [];
  if (input.slot1Name) groups.push({ items: [{ label: input.slot1Name, color: input.slot1Color }] });
  if (input.slot2Name) groups.push({ items: [{ label: input.slot2Name, color: input.slot2Color }] });
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
    const beforeSnapshot = buildSnapshotFromGroups(buildGroupsFromEntries(beforeEntries));

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
              }))
              .filter((item) => item.label.length > 0),
          }))
          .filter((group) => group.items.length > 0)
      : groupsFromLegacySlots({ slot1Name, slot2Name, slot1Color, slot2Color });

    if (normalizedGroups.length > 2) {
      return Response.json({ ok: false, error: '最大2枠までです' }, { status: 400 });
    }
    if (normalizedGroups.filter((group) => group.items.length > 1).length > 1) {
      return Response.json({ ok: false, error: '複数店舗を持てる枠は1つだけです' }, { status: 400 });
    }
    if (normalizedGroups.some((group) => group.items.length > 4)) {
      return Response.json({ ok: false, error: '同名別店舗は1枠4件までです' }, { status: 400 });
    }

    const resolvedGroups = await Promise.all(
      normalizedGroups.map(async (group) => ({
        items: await Promise.all(
          group.items.map(async (item) => {
            const site = await resolveSiteByName(item.label, kind);
            return site ? { site, color: item.color } : null;
          }),
        ),
      })),
    );

    const finalGroups: Array<{ items: Array<{ site: { id: string; name: string }; color: LabelColor }> }> = resolvedGroups.map((group) => ({
      items: group.items.filter((item): item is { site: { id: string; name: string }; color: LabelColor } => !!item),
    }));

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
              summary: item.site.name,
              siteId: item.site.id,
              accountingMeta: {
                siteName: item.site.name,
                labelColor: item.color,
                scheduleGroupIndex: groupIndex,
                scheduleItemIndex: itemIndex,
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
      after: buildSnapshotFromGroups(
        finalGroups.map((group) => ({
          items: group.items.map((item) => ({ label: item.site.name, color: item.color })),
        })),
      ),
    });

    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return Response.json({ ok: false, error: msg }, { status: 503 });
  }
}
