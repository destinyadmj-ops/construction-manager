import { createHash } from 'crypto';

import { cookies } from 'next/headers';

import { prisma } from '@/server/db/prisma';

const COOKIE_NAME = 'masterHub.uid';

export type ScheduleLabelColor = 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink';

export type ScheduleCellSnapshot = {
  slot1: string | null;
  slot1Color: ScheduleLabelColor;
  slot2: string | null;
  slot2Color: ScheduleLabelColor;
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
  };
}

export function createScheduleCellSnapshot(input: {
  slot1?: string | null;
  slot1Color?: ScheduleLabelColor | null;
  slot2?: string | null;
  slot2Color?: ScheduleLabelColor | null;
}): ScheduleCellSnapshot {
  return {
    slot1: normalize(input.slot1) || null,
    slot1Color: normalizeColor(input.slot1Color),
    slot2: normalize(input.slot2) || null,
    slot2Color: normalizeColor(input.slot2Color),
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
  });
}

export function scheduleCellSnapshotEquals(a: ScheduleCellSnapshot, b: ScheduleCellSnapshot) {
  return (
    a.slot1 === b.slot1 &&
    a.slot1Color === b.slot1Color &&
    a.slot2 === b.slot2 &&
    a.slot2Color === b.slot2Color
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
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' / ') : '（空）';
}

function formatScheduleCellProjectLabel(snapshot: ScheduleCellSnapshot) {
  const parts = [snapshot.slot1, snapshot.slot2].map((value) => normalize(value)).filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' / ') : '';
}

export function pickScheduleHistoryProjectLabel(before: ScheduleCellSnapshot, after: ScheduleCellSnapshot) {
  return formatScheduleCellProjectLabel(after) || formatScheduleCellProjectLabel(before);
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
}) {
  if (scheduleCellSnapshotEquals(input.before, input.after)) return;

  try {
    const editor = await resolveScheduleEditorContext(input.request);
    await prisma.scheduleChangeHistory.create({
      data: {
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
        editorLabel: editor.editorLabel,
        editorIpHash: editor.editorIpHash,
        editorUserAgentHash: editor.editorUserAgentHash,
        editorHost: editor.editorHost,
        editorPlatform: editor.editorPlatform,
        editorLanguage: editor.editorLanguage,
        editorTimeZone: editor.editorTimeZone,
      },
    });
  } catch {
    // Audit logging is best-effort and must not block schedule writes.
  }
}