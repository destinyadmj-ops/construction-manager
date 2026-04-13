import { prisma } from '@/server/db/prisma';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import { buildAutoFillTargets } from '@/shared/pace';
import { z } from 'zod';

export const runtime = 'nodejs';

const BodySchema = z
  .object({
    userId: z.string().min(1),
    siteId: z.string().min(1),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    days: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .max(62)
      .optional(),
  })
  .strict();

function startOfDayLocal(ymd: string) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export async function POST(request: Request) {
  try {
    const authError = await requireScheduleEditor(request);
    if (authError) return authError;

    const json = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(json ?? {});
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: 'Invalid body', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { userId, siteId, kind, month, days } = parsed.data;
    const workEntryKind = kind ?? 'NORMAL';

    if ((!month || month.length === 0) && (!days || days.length === 0)) {
      return Response.json({ ok: false, error: 'month or days is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return Response.json({ ok: false, error: 'User not found' }, { status: 404 });

    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, name: true, pace: true, repeatRule: true, createdAt: true },
    });
    if (!site) return Response.json({ ok: false, error: 'Site not found' }, { status: 404 });

    const normalizedDays = Array.isArray(days) ? Array.from(new Set(days)).sort() : null;
    const monthToUse = month ?? (normalizedDays ? normalizedDays[0]!.slice(0, 7) : null);
    if (!monthToUse) {
      return Response.json({ ok: false, error: 'month or days is required' }, { status: 400 });
    }

    const preview = buildAutoFillTargets({
      rule: site.repeatRule,
      pace: site.pace,
      month: monthToUse,
      anchorDate: site.createdAt,
      days: normalizedDays,
    });

    if (preview.status === 'invalid-month') {
      return Response.json({ ok: false, error: 'month must be YYYY-MM' }, { status: 400 });
    }

    if (preview.status === 'interval-mismatch') {
      return Response.json({
        ok: true,
        created: 0,
        skipped: 0,
        reason: 'ペース対象外の月です',
      });
    }

    if (preview.status === 'no-repeat') {
      return Response.json({ ok: true, created: 0, skipped: 0, reason: 'リピート条件が未設定です' });
    }

    const [yy, mm] = monthToUse.split('-').map((x) => Number(x));
    const monthStart = new Date(yy, mm - 1, 1, 0, 0, 0, 0);
    const nextMonth = new Date(yy, mm, 1, 0, 0, 0, 0);

    const existingRange = normalizedDays
      ? {
          gte: startOfDayLocal(normalizedDays[0]!),
          lt: (() => {
            const last = startOfDayLocal(normalizedDays[normalizedDays.length - 1]!);
            last.setDate(last.getDate() + 1);
            return last;
          })(),
        }
      : { gte: monthStart, lt: nextMonth };

    const existing = await prisma.workEntry.findMany({
      where: {
        userId,
        siteId,
        kind: workEntryKind,
        startAt: existingRange,
      },
      select: { startAt: true },
    });

    const existingDays = new Set(existing.map((e) => toYmd(e.startAt)));

    const targets = preview.targets;

    const toCreate = targets.filter((ymd) => !existingDays.has(ymd));

    if (toCreate.length === 0) {
      return Response.json({ ok: true, created: 0, skipped: targets.length });
    }

    await prisma.workEntry.createMany({
      data: toCreate.map((ymd) => ({
        userId,
        siteId,
        kind: workEntryKind,
        startAt: startOfDayLocal(ymd),
        summary: site.name,
        accountingMeta: { siteName: site.name },
      })),
    });

    return Response.json({ ok: true, created: toCreate.length, skipped: targets.length - toCreate.length });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}
