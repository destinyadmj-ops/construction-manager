import { prisma } from '@/server/db/prisma';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import { z } from 'zod';

export const runtime = 'nodejs';

const QuerySchema = z.object({
  kind: z.enum(['NORMAL', 'DAILY']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
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
  const limit = parsed.data.limit ?? 200;

  try {
    const [items, total] = await Promise.all([
      prisma.scheduleChangeHistory.findMany({
        where: { kind },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: {
          id: true,
          dayYmd: true,
          targetUserLabel: true,
          projectLabel: true,
          targetLabel: true,
          beforeValue: true,
          afterValue: true,
          editorLabel: true,
          editorHost: true,
          editorPlatform: true,
          editorLanguage: true,
          editorTimeZone: true,
          createdAt: true,
        },
      }),
      prisma.scheduleChangeHistory.count({ where: { kind } }),
    ]);

    return Response.json({ ok: true, total, items });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load history' },
      { status: 503 },
    );
  }
}