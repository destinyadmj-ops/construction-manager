import { prisma } from '@/server/db/prisma';
import { Prisma } from '@/generated/prisma';

type ScheduleKind = 'NORMAL' | 'DAILY';

const GLOBAL_UI_SETTINGS_USER_ID = '__MASTER_HUB_GLOBAL__';

function buildUserOrderKey(kind: ScheduleKind): string {
  const normalized = kind === 'DAILY' ? 'daily' : 'normal';
  return `week-hub:${normalized}:userOrder`;
}

function normalizeOrderIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function normalizeScheduleUserNameKey(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ja-JP').trim();
}

export function collapseDuplicateScheduleUsers<T extends { id: string; name: string | null }>(users: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const user of users) {
    const key = normalizeScheduleUserNameKey(user.name);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(user);
  }

  return result;
}

export async function readGlobalScheduleUserOrder(kind: ScheduleKind): Promise<string[]> {
  const key = buildUserOrderKey(kind);
  try {
    const setting = await prisma.userUiSetting.findUnique({
      where: { userId_key: { userId: GLOBAL_UI_SETTINGS_USER_ID, key } },
      select: { value: true },
    });
    return normalizeOrderIds(setting?.value);
  } catch {
    return [];
  }
}

export async function applyGlobalScheduleUserOrder<T extends { id: string }>(kind: ScheduleKind, users: T[]): Promise<T[]> {
  if (users.length <= 1) return users;

  const order = await readGlobalScheduleUserOrder(kind);
  if (order.length === 0) return users;

  const byId = new Map(users.map((user) => [user.id, user] as const));
  const used = new Set<string>();
  const sorted: T[] = [];

  for (const id of order) {
    const hit = byId.get(id);
    if (!hit) continue;
    sorted.push(hit);
    used.add(id);
  }

  for (const user of users) {
    if (used.has(user.id)) continue;
    sorted.push(user);
  }

  return sorted;
}

export async function listVisibleScheduleUsers(kind: ScheduleKind): Promise<Array<{ id: string; name: string | null; email: string | null }>> {
  try {
    const usersRaw = await prisma.user.findMany({
      where: { kind, showInSchedule: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true },
      take: 200,
    });
    return applyGlobalScheduleUserOrder(kind, usersRaw);
  } catch {
    const fallbackUsers = await prisma.user.findMany({
      where: { kind },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, email: true },
      take: 200,
    });
    const ordered = await applyGlobalScheduleUserOrder(kind, fallbackUsers);
    return collapseDuplicateScheduleUsers(ordered);
  }
}

export async function saveGlobalScheduleUserOrder(kind: ScheduleKind, orderIds: string[]): Promise<void> {
  const normalized = normalizeOrderIds(orderIds);

  const key = buildUserOrderKey(kind);
  try {
    await prisma.userUiSetting.upsert({
      where: { userId_key: { userId: GLOBAL_UI_SETTINGS_USER_ID, key } },
      create: {
        userId: GLOBAL_UI_SETTINGS_USER_ID,
        key,
        value: normalized as Prisma.InputJsonValue,
      },
      update: {
        value: normalized as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  } catch {
    // Legacy DBs may reject the synthetic global userId. Keep sync functional without persistence.
  }
}
