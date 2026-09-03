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

export async function applyGlobalScheduleUserOrder<T extends { id: string }>(kind: ScheduleKind, users: T[]): Promise<T[]> {
  if (users.length <= 1) return users;

  const key = buildUserOrderKey(kind);
  const setting = await prisma.userUiSetting.findUnique({
    where: { userId_key: { userId: GLOBAL_UI_SETTINGS_USER_ID, key } },
    select: { value: true },
  });

  const order = normalizeOrderIds(setting?.value);
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

export async function saveGlobalScheduleUserOrder(kind: ScheduleKind, orderIds: string[]): Promise<void> {
  const normalized = normalizeOrderIds(orderIds);
  if (normalized.length === 0) return;

  const key = buildUserOrderKey(kind);
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
}
