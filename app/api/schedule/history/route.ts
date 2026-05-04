import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import { listScheduleChangeHistory, SCHEDULE_CHANGE_HISTORY_DEFAULT_LIMIT } from '@/server/schedule/change-history';
import { z } from 'zod';

export const runtime = 'nodejs';

const QuerySchema = z.object({
  kind: z.enum(['NORMAL', 'DAILY']).optional(),
  limit: z.coerce.number().int().min(1).max(SCHEDULE_CHANGE_HISTORY_DEFAULT_LIMIT).optional(),
});

export async function GET(request: Request) {
  const authError = await requireScheduleEditor(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    kind: (url.searchParams.get('kind') ?? '').trim().toUpperCase() || undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid query', issues: parsed.error.issues }, { status: 400 });
  }

  const kind = parsed.data.kind ?? 'NORMAL';
  const limit = parsed.data.limit ?? SCHEDULE_CHANGE_HISTORY_DEFAULT_LIMIT;

  try {
    const { items, total } = await listScheduleChangeHistory({ kind, limit });

    return Response.json({ ok: true, total, items });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load history' },
      { status: 503 },
    );
  }
}