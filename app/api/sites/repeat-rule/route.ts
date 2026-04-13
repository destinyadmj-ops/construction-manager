import { prisma } from '@/server/db/prisma';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import { formatPaceText, parseRepeatRule } from '@/shared/pace';
import { z } from 'zod';

export const runtime = 'nodejs';

const RepeatRuleSchema = z
  .object({
    intervalMonths: z.number().int().min(1).max(12),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional().nullable(), // 1=Mon ... 7=Sun
    monthDays: z.array(z.number().int().min(1).max(31)).max(31).optional().nullable(),
    monthsOfYear: z.array(z.number().int().min(1).max(12)).max(12).optional().nullable(),
  })
  .strict();

const BodySchema = z
  .object({
    siteId: z.string().min(1),
    repeatRule: RepeatRuleSchema,
    pace: z.string().max(200).optional().nullable(),
  })
  .strict();

export async function POST(request: Request) {
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

  const updated = await prisma.site.update({
    where: { id: parsed.data.siteId },
    data: {
      repeatRule: parseRepeatRule(parsed.data.repeatRule),
      ...(parsed.data.pace !== undefined ? { pace: formatPaceText(parsed.data.pace) || null } : {}),
    },
    select: { id: true, pace: true, repeatRule: true, updatedAt: true },
  });

  return Response.json({ ok: true, site: updated });
}
