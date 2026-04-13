import { prisma } from '@/server/db/prisma';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import { z } from 'zod';

export const runtime = 'nodejs';

const RepeatRuleSchema = z
  .object({
    intervalMonths: z.number().int().min(1).max(12),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional().nullable(), // 1=Mon ... 7=Sun
    monthDays: z.array(z.number().int().min(1).max(31)).max(31).optional().nullable(),
  })
  .strict();

const BodySchema = z
  .object({
    siteId: z.string().min(1),
    repeatRule: RepeatRuleSchema,
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
    data: { repeatRule: parsed.data.repeatRule },
    select: { id: true, repeatRule: true, updatedAt: true },
  });

  return Response.json({ ok: true, site: updated });
}
