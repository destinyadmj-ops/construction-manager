import { getCurrentUserId } from '@/server/auth/current-user';
import { listPersonalScheduleSummaryForUsers } from '@/server/schedule/personal-schedule';
import { isValidPersonalScheduleMonth } from '@/shared/personal-schedule';
import { z } from 'zod';

export const runtime = 'nodejs';

const GetSchema = z
  .object({
    month: z.string(),
    userIds: z.string().optional(),
  })
  .strict();

export async function GET(request: Request) {
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = GetSchema.safeParse({
    month: (url.searchParams.get('month') ?? '').trim(),
    userIds: (url.searchParams.get('userIds') ?? '').trim() || undefined,
  });
  if (!parsed.success || !isValidPersonalScheduleMonth(parsed.data.month)) {
    return Response.json({ ok: false, error: 'Invalid query' }, { status: 400 });
  }

  const userIds = parsed.data.userIds
    ? parsed.data.userIds.split(',').map((userId) => userId.trim()).filter((userId) => userId.length > 0)
    : [currentUserId];

  try {
    const summary = await listPersonalScheduleSummaryForUsers(userIds, parsed.data.month);
    return Response.json({ ok: true, month: parsed.data.month, summary });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}