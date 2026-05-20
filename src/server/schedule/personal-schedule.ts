import { prisma } from '@/server/db/prisma';
import {
  PERSONAL_SCHEDULE_SLOT_COUNT,
  buildPersonalScheduleMonthDays,
  createEmptyPersonalScheduleDay,
  normalizePersonalScheduleColor,
  type PersonalScheduleColor,
  type PersonalScheduleDay,
  type PersonalScheduleItem,
  type PersonalScheduleSummaryDay,
} from '@/shared/personal-schedule';

type PersonalScheduleRow = {
  id: string;
  userId: string;
  dayYmd: string;
  slotIndex: number;
  title: string;
  note: string | null;
  color: string;
  createdAt: Date;
  updatedAt: Date;
};

function toPersonalScheduleItem(row: PersonalScheduleRow): PersonalScheduleItem {
  return {
    id: row.id,
    dayYmd: row.dayYmd,
    slotIndex: row.slotIndex,
    title: row.title,
    note: row.note,
    color: normalizePersonalScheduleColor(row.color),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function createMonthDayMap(days: string[]) {
  const map = new Map<string, PersonalScheduleDay>();
  for (const day of days) {
    map.set(day, createEmptyPersonalScheduleDay(day));
  }
  return map;
}

export async function listPersonalScheduleMonthForUser(userId: string, month: string) {
  const days = buildPersonalScheduleMonthDays(month);
  if (days.length === 0) {
    return { month, days: [] as PersonalScheduleDay[] };
  }

  const rows = await prisma.personalScheduleEntry.findMany({
    where: { userId, dayYmd: { gte: days[0], lte: days[days.length - 1] } },
    orderBy: [{ dayYmd: 'asc' }, { slotIndex: 'asc' }],
  });

  const dayMap = createMonthDayMap(days);
  for (const row of rows) {
    const day = dayMap.get(row.dayYmd);
    if (!day) continue;
    if (row.slotIndex < 0 || row.slotIndex >= PERSONAL_SCHEDULE_SLOT_COUNT) continue;
    day.items[row.slotIndex] = toPersonalScheduleItem(row as PersonalScheduleRow);
    day.count += 1;
  }

  return { month, days: days.map((day) => dayMap.get(day) ?? createEmptyPersonalScheduleDay(day)) };
}

export async function listPersonalScheduleSummaryForUsers(userIds: string[], month: string) {
  const uniqueUserIds = Array.from(
    new Set(userIds.map((userId) => userId.trim()).filter((userId) => userId.length > 0)),
  ).slice(0, 200);
  const summary: Record<string, Record<string, PersonalScheduleSummaryDay>> = {};
  for (const userId of uniqueUserIds) {
    summary[userId] = {};
  }

  const days = buildPersonalScheduleMonthDays(month);
  if (uniqueUserIds.length === 0 || days.length === 0) {
    return summary;
  }

  const rows = await prisma.personalScheduleEntry.findMany({
    where: {
      userId: { in: uniqueUserIds },
      dayYmd: { gte: days[0], lte: days[days.length - 1] },
    },
    orderBy: [{ userId: 'asc' }, { dayYmd: 'asc' }, { slotIndex: 'asc' }],
  });

  for (const row of rows) {
    const byDay = summary[row.userId] ?? (summary[row.userId] = {});
    const day = byDay[row.dayYmd] ?? (byDay[row.dayYmd] = { count: 0, items: [] });
    day.count += 1;
    day.items.push({
      id: row.id,
      slotIndex: row.slotIndex,
      title: row.title,
      note: row.note,
      color: normalizePersonalScheduleColor(row.color),
    });
  }

  return summary;
}

export async function upsertPersonalScheduleEntry(input: {
  userId: string;
  dayYmd: string;
  slotIndex: number;
  title: string;
  note: string | null;
  color: PersonalScheduleColor;
}) {
  const saved = await prisma.personalScheduleEntry.upsert({
    where: {
      userId_dayYmd_slotIndex: {
        userId: input.userId,
        dayYmd: input.dayYmd,
        slotIndex: input.slotIndex,
      },
    },
    create: input,
    update: {
      title: input.title,
      note: input.note,
      color: input.color,
    },
  });

  return toPersonalScheduleItem(saved as PersonalScheduleRow);
}

export async function deletePersonalScheduleEntry(userId: string, dayYmd: string, slotIndex: number) {
  const result = await prisma.personalScheduleEntry.deleteMany({ where: { userId, dayYmd, slotIndex } });
  return result.count > 0;
}