import { createHash, randomUUID } from 'crypto';

import { cookies } from 'next/headers';

import { Prisma } from '@/generated/prisma';
import { prisma } from '@/server/db/prisma';
import {
  normalizeScheduleCellEntryKind,
  normalizeScheduleCellNote,
  type ScheduleCellEntryKind,
} from '@/shared/schedule-cell-entry';

const COOKIE_NAME = 'masterHub.uid';
export const SCHEDULE_CHANGE_HISTORY_RETENTION_DAYS = 21;
export const SCHEDULE_CHANGE_HISTORY_DEFAULT_LIMIT = 5000;

export type ScheduleLabelColor = 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink';

export type ScheduleHistoryGroupItem = {
  label: string;
  color: ScheduleLabelColor;
  kind: ScheduleCellEntryKind;
};

export type ScheduleHistoryGroup = {
  items: ScheduleHistoryGroupItem[];
  note: string | null;
};

export type ScheduleCellSnapshot = {
  slot1: string | null;
  slot1Color: ScheduleLabelColor;
  slot2: string | null;
  slot2Color: ScheduleLabelColor;
  slot3: string | null;
  slot3Color: ScheduleLabelColor;
  slot4: string | null;
  slot4Color: ScheduleLabelColor;
};

export type ScheduleChangeHistoryListItem = {
  id: string;
  dayYmd: string;
  targetUserId: string;
  targetUserLabel: string;
  projectLabel: string;
  targetLabel: string;
  beforeValue: string;
  afterValue: string;
  beforeGroups: ScheduleHistoryGroup[] | null;
  afterGroups: ScheduleHistoryGroup[] | null;
  editorLabel: string;
  editorHost: string;
  editorPlatform: string;
  editorLanguage: string;
  editorTimeZone: string;
  createdAt: Date;
};

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(value: string | null | undefined) {
  return (value ?? '').trim();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getScheduleChangeHistoryDelegate() {
  return prisma.scheduleChangeHistory as typeof prisma.scheduleChangeHistory | undefined;
}

function getScheduleHistoryCutoff(now = new Date()) {
  return new Date(now.getTime() - SCHEDULE_CHANGE_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function clampScheduleHistoryLimit(limit: number) {
  return Math.max(1, Math.min(SCHEDULE_CHANGE_HISTORY_DEFAULT_LIMIT, Math.round(limit)));
}

function getRequestIp(request: Request) {
  const forwarded = normalize(request.headers.get('x-forwarded-for'));
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? '';
  return normalize(request.headers.get('x-real-ip'));
}

function getRequestUserAgent(request: Request) {
  return normalize(request.headers.get('user-agent'));
}

function normalizeColor(value: unknown): ScheduleLabelColor {
  return value === 'red' ||
    value === 'orange' ||
    value === 'yellow' ||
    value === 'green' ||
    value === 'blue' ||
    value === 'purple' ||
    value === 'pink'
    ? value
    : 'default';
}

function normalizeScheduleHistoryGroupItem(value: unknown): ScheduleHistoryGroupItem | null {
  const input = asObject(value);
  if (!input) return null;

  const label = normalize(typeof input.label === 'string' ? input.label : null);
  if (!label) return null;

  return {
    label,
    color: normalizeColor(input.color),
    kind: normalizeScheduleCellEntryKind(input.kind),
  };
}

function normalizeScheduleHistoryGroup(value: unknown): ScheduleHistoryGroup | null {
  const input = asObject(value);
  if (!input || !Array.isArray(input.items)) return null;

  const items = input.items
    .map((item) => normalizeScheduleHistoryGroupItem(item))
    .filter((item): item is ScheduleHistoryGroupItem => !!item)
    .slice(0, 4);

  if (items.length === 0) return null;

  return {
    items,
    note: normalizeScheduleCellNote(input.note),
  };
}

export function normalizeScheduleHistoryGroups(value: unknown): ScheduleHistoryGroup[] | null {
  if (!Array.isArray(value)) return null;

  const groups = value
    .map((group) => normalizeScheduleHistoryGroup(group))
    .filter((group): group is ScheduleHistoryGroup => !!group)
    .slice(0, 4);

  return groups;
}

function createScheduleHistoryGroupsFromSnapshot(snapshot: ScheduleCellSnapshot): ScheduleHistoryGroup[] {
  const groups: ScheduleHistoryGroup[] = [];

  const pushSlot = (label: string | null, color: ScheduleLabelColor) => {
    const normalizedLabel = normalize(label);
    if (!normalizedLabel) return;
    groups.push({
      items: [{ label: normalizedLabel, color, kind: 'site' }],
      note: null,
    });
  };

  pushSlot(snapshot.slot1, snapshot.slot1Color);
  pushSlot(snapshot.slot2, snapshot.slot2Color);
  pushSlot(snapshot.slot3, snapshot.slot3Color);
  pushSlot(snapshot.slot4, snapshot.slot4Color);

  return groups;
}

function scheduleHistoryGroupsEqual(a: ScheduleHistoryGroup[] | null | undefined, b: ScheduleHistoryGroup[] | null | undefined) {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function extractEntryLabel(entry: { summary?: string | null; accountingMeta?: unknown }) {
  const meta = asObject(entry.accountingMeta);
  const metaSiteName = typeof meta?.siteName === 'string' ? normalize(meta.siteName) : '';
  return metaSiteName || normalize(entry.summary) || null;
}

function extractEntryColor(entry: { accountingMeta?: unknown }): ScheduleLabelColor {
  const meta = asObject(entry.accountingMeta);
  return normalizeColor(meta?.labelColor);
}

export function emptyScheduleCellSnapshot(): ScheduleCellSnapshot {
  return {
    slot1: null,
    slot1Color: 'default',
    slot2: null,
    slot2Color: 'default',
    slot3: null,
    slot3Color: 'default',
    slot4: null,
    slot4Color: 'default',
  };
}

export function createScheduleCellSnapshot(input: {
  slot1?: string | null;
  slot1Color?: ScheduleLabelColor | null;
  slot2?: string | null;
  slot2Color?: ScheduleLabelColor | null;
  slot3?: string | null;
  slot3Color?: ScheduleLabelColor | null;
  slot4?: string | null;
  slot4Color?: ScheduleLabelColor | null;
}): ScheduleCellSnapshot {
  return {
    slot1: normalize(input.slot1) || null,
    slot1Color: normalizeColor(input.slot1Color),
    slot2: normalize(input.slot2) || null,
    slot2Color: normalizeColor(input.slot2Color),
    slot3: normalize(input.slot3) || null,
    slot3Color: normalizeColor(input.slot3Color),
    slot4: normalize(input.slot4) || null,
    slot4Color: normalizeColor(input.slot4Color),
  };
}

export function createScheduleCellSnapshotFromWorkEntries(
  entries: Array<{ summary?: string | null; accountingMeta?: unknown }>,
): ScheduleCellSnapshot {
  return createScheduleCellSnapshot({
    slot1: entries[0] ? extractEntryLabel(entries[0]) : null,
    slot1Color: entries[0] ? extractEntryColor(entries[0]) : 'default',
    slot2: entries[1] ? extractEntryLabel(entries[1]) : null,
    slot2Color: entries[1] ? extractEntryColor(entries[1]) : 'default',
    slot3: entries[2] ? extractEntryLabel(entries[2]) : null,
    slot3Color: entries[2] ? extractEntryColor(entries[2]) : 'default',
    slot4: entries[3] ? extractEntryLabel(entries[3]) : null,
    slot4Color: entries[3] ? extractEntryColor(entries[3]) : 'default',
  });
}

export function scheduleCellSnapshotEquals(a: ScheduleCellSnapshot, b: ScheduleCellSnapshot) {
  return (
    a.slot1 === b.slot1 &&
    a.slot1Color === b.slot1Color &&
    a.slot2 === b.slot2 &&
    a.slot2Color === b.slot2Color &&
    a.slot3 === b.slot3 &&
    a.slot3Color === b.slot3Color &&
    a.slot4 === b.slot4 &&
    a.slot4Color === b.slot4Color
  );
}

function colorLabel(color: ScheduleLabelColor) {
  switch (color) {
    case 'red':
      return '赤';
    case 'orange':
      return '橙';
    case 'yellow':
      return '黄';
    case 'green':
      return '緑';
    case 'blue':
      return '青';
    case 'purple':
      return '紫';
    case 'pink':
      return '桃';
    default:
      return '通常';
  }
}

export function formatScheduleCellSnapshot(snapshot: ScheduleCellSnapshot) {
  const parts = [
    snapshot.slot1 ? `${snapshot.slot1}${snapshot.slot1Color === 'default' ? '' : ` [${colorLabel(snapshot.slot1Color)}]`}` : null,
    snapshot.slot2 ? `${snapshot.slot2}${snapshot.slot2Color === 'default' ? '' : ` [${colorLabel(snapshot.slot2Color)}]`}` : null,
    snapshot.slot3 ? `${snapshot.slot3}${snapshot.slot3Color === 'default' ? '' : ` [${colorLabel(snapshot.slot3Color)}]`}` : null,
    snapshot.slot4 ? `${snapshot.slot4}${snapshot.slot4Color === 'default' ? '' : ` [${colorLabel(snapshot.slot4Color)}]`}` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' / ') : '（空）';
}

function formatScheduleCellProjectLabel(snapshot: ScheduleCellSnapshot) {
  const parts = [snapshot.slot1, snapshot.slot2, snapshot.slot3, snapshot.slot4]
    .map((value) => normalize(value))
    .filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' / ') : '';
}

export function pickScheduleHistoryProjectLabel(before: ScheduleCellSnapshot, after: ScheduleCellSnapshot) {
  return formatScheduleCellProjectLabel(after) || formatScheduleCellProjectLabel(before);
}

export async function listScheduleChangeHistory(input: {
  kind: 'NORMAL' | 'DAILY';
  limit?: number;
}) {
  const cutoff = getScheduleHistoryCutoff();
  const take = clampScheduleHistoryLimit(input.limit ?? SCHEDULE_CHANGE_HISTORY_DEFAULT_LIMIT);
  const delegate = getScheduleChangeHistoryDelegate();

  if (delegate?.findMany && delegate?.count) {
    const [items, total] = await Promise.all([
      delegate.findMany({
        where: {
          kind: input.kind,
          createdAt: { gte: cutoff },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          dayYmd: true,
          targetUserId: true,
          targetUserLabel: true,
          projectLabel: true,
          targetLabel: true,
          beforeValue: true,
          afterValue: true,
          beforeGroups: true,
          afterGroups: true,
          editorLabel: true,
          editorHost: true,
          editorPlatform: true,
          editorLanguage: true,
          editorTimeZone: true,
          createdAt: true,
        },
      }),
      delegate.count({
        where: {
          kind: input.kind,
          createdAt: { gte: cutoff },
        },
      }),
    ]);

    return { items, total };
  }

  const [items, totalRows] = await Promise.all([
    prisma.$queryRaw<ScheduleChangeHistoryListItem[]>(Prisma.sql`
      SELECT
        "id",
        "dayYmd",
        "targetUserId",
        "targetUserLabel",
        "projectLabel",
        "targetLabel",
        "beforeValue",
        "afterValue",
        "beforeGroups",
        "afterGroups",
        "editorLabel",
        "editorHost",
        "editorPlatform",
        "editorLanguage",
        "editorTimeZone",
        "createdAt"
      FROM "ScheduleChangeHistory"
      WHERE "kind" = CAST(${input.kind} AS "WorkEntryKind")
        AND "createdAt" >= ${cutoff}
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT ${take}
    `),
    prisma.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total
      FROM "ScheduleChangeHistory"
      WHERE "kind" = CAST(${input.kind} AS "WorkEntryKind")
        AND "createdAt" >= ${cutoff}
    `),
  ]);

  return {
    items: items.map((item) => ({
      ...item,
      beforeGroups: normalizeScheduleHistoryGroups(item.beforeGroups),
      afterGroups: normalizeScheduleHistoryGroups(item.afterGroups),
    })),
    total: Number(totalRows[0]?.total ?? 0),
  };
}

async function pruneScheduleChangeHistory() {
  const cutoff = getScheduleHistoryCutoff();
  const delegate = getScheduleChangeHistoryDelegate();

  if (delegate?.deleteMany) {
    await delegate.deleteMany({
      where: {
        createdAt: { lt: cutoff },
      },
    });
    return;
  }

  await prisma.$executeRaw`
    DELETE FROM "ScheduleChangeHistory"
    WHERE "createdAt" < ${cutoff}
  `;
}

async function resolveScheduleEditorContext(request: Request) {
  const jar = await cookies();
  const userId = normalize(jar.get(COOKIE_NAME)?.value);
  const ip = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);
  const ipHash = ip ? sha256(ip) : null;
  const userAgentHash = userAgent ? sha256(userAgent) : null;

  if (!userId) {
    return {
      editorUserId: null,
      editorLabel: '管理者',
      editorLoginMemoryId: null,
      editorIpHash: ipHash,
      editorUserAgentHash: userAgentHash,
      editorHost: '',
      editorPlatform: '',
      editorLanguage: '',
      editorTimeZone: '',
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });

  const loginMemory = await prisma.userLoginMemory.findFirst({
    where: {
      userId,
      ...(userAgentHash ? { userAgentHash } : {}),
      ...(ipHash ? { OR: [{ ipHash }, { ipHash: null }] } : {}),
    },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, host: true, platform: true, language: true, timeZone: true },
  });

  return {
    editorUserId: user?.id ?? userId,
    editorLabel: user?.name ?? user?.email ?? userId,
    editorLoginMemoryId: loginMemory?.id ?? null,
    editorIpHash: ipHash,
    editorUserAgentHash: userAgentHash,
    editorHost: loginMemory?.host ?? '',
    editorPlatform: loginMemory?.platform ?? '',
    editorLanguage: loginMemory?.language ?? '',
    editorTimeZone: loginMemory?.timeZone ?? '',
  };
}

export async function recordScheduleChangeHistory(input: {
  request: Request;
  kind: 'NORMAL' | 'DAILY';
  targetUserId: string;
  targetUserLabel: string;
  dayYmd: string;
  targetLabel: string;
  before: ScheduleCellSnapshot;
  after: ScheduleCellSnapshot;
  beforeGroups?: ScheduleHistoryGroup[] | null;
  afterGroups?: ScheduleHistoryGroup[] | null;
}) {
  const beforeGroups = normalizeScheduleHistoryGroups(input.beforeGroups) ?? createScheduleHistoryGroupsFromSnapshot(input.before);
  const afterGroups = normalizeScheduleHistoryGroups(input.afterGroups) ?? createScheduleHistoryGroupsFromSnapshot(input.after);

  if (scheduleCellSnapshotEquals(input.before, input.after) && scheduleHistoryGroupsEqual(beforeGroups, afterGroups)) return;

  try {
    const editor = await resolveScheduleEditorContext(input.request);
    const delegate = getScheduleChangeHistoryDelegate();
    const payload = {
      kind: input.kind,
      targetUserId: input.targetUserId,
      targetUserLabel: input.targetUserLabel,
      editorUserId: editor.editorUserId,
      editorLoginMemoryId: editor.editorLoginMemoryId,
      dayYmd: input.dayYmd,
      projectLabel: pickScheduleHistoryProjectLabel(input.before, input.after),
      targetLabel: input.targetLabel,
      beforeValue: formatScheduleCellSnapshot(input.before),
      afterValue: formatScheduleCellSnapshot(input.after),
      beforeGroups,
      afterGroups,
      editorLabel: editor.editorLabel,
      editorIpHash: editor.editorIpHash,
      editorUserAgentHash: editor.editorUserAgentHash,
      editorHost: editor.editorHost,
      editorPlatform: editor.editorPlatform,
      editorLanguage: editor.editorLanguage,
      editorTimeZone: editor.editorTimeZone,
    };

    if (delegate?.create) {
      await delegate.create({
        data: {
          ...payload,
          beforeGroups: payload.beforeGroups as unknown as Prisma.InputJsonValue,
          afterGroups: payload.afterGroups as unknown as Prisma.InputJsonValue,
        },
      });
    } else {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "ScheduleChangeHistory" (
          "id",
          "kind",
          "targetUserId",
          "editorUserId",
          "editorLoginMemoryId",
          "dayYmd",
          "targetUserLabel",
          "projectLabel",
          "targetLabel",
          "beforeValue",
          "afterValue",
          "beforeGroups",
          "afterGroups",
          "editorLabel",
          "editorIpHash",
          "editorUserAgentHash",
          "editorHost",
          "editorPlatform",
          "editorLanguage",
          "editorTimeZone"
        ) VALUES (
          ${randomUUID()},
          CAST(${payload.kind} AS "WorkEntryKind"),
          ${payload.targetUserId},
          ${payload.editorUserId},
          ${payload.editorLoginMemoryId},
          ${payload.dayYmd},
          ${payload.targetUserLabel},
          ${payload.projectLabel},
          ${payload.targetLabel},
          ${payload.beforeValue},
          ${payload.afterValue},
          CAST(${JSON.stringify(payload.beforeGroups)} AS jsonb),
          CAST(${JSON.stringify(payload.afterGroups)} AS jsonb),
          ${payload.editorLabel},
          ${payload.editorIpHash},
          ${payload.editorUserAgentHash},
          ${payload.editorHost},
          ${payload.editorPlatform},
          ${payload.editorLanguage},
          ${payload.editorTimeZone}
        )
      `);
    }

    await pruneScheduleChangeHistory();
  } catch {
    // Audit logging is best-effort and must not block schedule writes.
  }
}