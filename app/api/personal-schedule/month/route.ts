import { prisma } from '@/server/db/prisma';
import { getCurrentUserId } from '@/server/auth/current-user';
import {
  deletePersonalScheduleEntry,
  listPersonalScheduleMonthForUser,
  upsertPersonalScheduleEntry,
} from '@/server/schedule/personal-schedule';
import {
  PERSONAL_SCHEDULE_COLOR_VALUES,
  PERSONAL_SCHEDULE_SLOT_COUNT,
  isValidPersonalScheduleDay,
  isValidPersonalScheduleMonth,
  normalizePersonalScheduleColor,
  normalizePersonalScheduleNote,
  normalizePersonalScheduleTitle,
} from '@/shared/personal-schedule';
import { z } from 'zod';

export const runtime = 'nodejs';

const GetSchema = z.object({ month: z.string() }).strict();

const PostSchema = z
  .object({
    dayYmd: z.string(),
    slotIndex: z.number().int().min(0).max(PERSONAL_SCHEDULE_SLOT_COUNT - 1),
    title: z.string().max(80),
    note: z.string().max(500).nullable().optional(),
    color: z.enum(PERSONAL_SCHEDULE_COLOR_VALUES).optional(),
  })
  .strict();

const DeleteSchema = z
  .object({
    dayYmd: z.string(),
    slotIndex: z.number().int().min(0).max(PERSONAL_SCHEDULE_SLOT_COUNT - 1),
  })
  .strict();

async function resolveCurrentUser() {
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) return null;
  return prisma.user.findUnique({
    where: { id: currentUserId },
    select: { id: true, name: true, email: true },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = GetSchema.safeParse({ month: (url.searchParams.get('month') ?? '').trim() });
  if (!parsed.success || !isValidPersonalScheduleMonth(parsed.data.month)) {
    return Response.json({ ok: false, error: 'Invalid month' }, { status: 400 });
  }

  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const monthData = await listPersonalScheduleMonthForUser(user.id, parsed.data.month);
    return Response.json({ ok: true, month: monthData.month, user, days: monthData.days });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = PostSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const dayYmd = parsed.data.dayYmd.trim();
  if (!isValidPersonalScheduleDay(dayYmd)) {
    return Response.json({ ok: false, error: 'Invalid day' }, { status: 400 });
  }

  const title = normalizePersonalScheduleTitle(parsed.data.title);
  if (!title) {
    return Response.json({ ok: false, error: 'タイトルを入力してください' }, { status: 400 });
  }

  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const saved = await upsertPersonalScheduleEntry({
      userId: user.id,
      dayYmd,
      slotIndex: parsed.data.slotIndex,
      title,
      note: normalizePersonalScheduleNote(parsed.data.note),
      color: normalizePersonalScheduleColor(parsed.data.color),
    });
    return Response.json({ ok: true, item: saved });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = DeleteSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const dayYmd = parsed.data.dayYmd.trim();
  if (!isValidPersonalScheduleDay(dayYmd)) {
    return Response.json({ ok: false, error: 'Invalid day' }, { status: 400 });
  }

  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const removed = await deletePersonalScheduleEntry(user.id, dayYmd, parsed.data.slotIndex);
    return Response.json({ ok: true, removed });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}