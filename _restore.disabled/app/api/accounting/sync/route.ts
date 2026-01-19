import { getAccountingProvider } from '@/server/accounting';
import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const BodySchema = z
  .object({
    since: z.string().datetime().optional().nullable(),
    until: z.string().datetime().optional().nullable(),
    metaKeys: z.array(z.string()).max(50).optional().nullable(),
  })
  .strict();

export async function POST(request: Request) {
  const provider = getAccountingProvider();

  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const since = parsed.data.since ? new Date(parsed.data.since) : null;
  const until = parsed.data.until ? new Date(parsed.data.until) : null;
  const metaKeys = parsed.data.metaKeys ?? [];

  const entries = await prisma.workEntry.findMany({
    where: {
      ...(since ? { startAt: { gte: since } } : {}),
      ...(until ? { startAt: { lt: until } } : {}),
    },
    orderBy: { startAt: 'asc' },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      note: true,
      amount: true,
      taxCategory: true,
      summary: true,
      department: true,
      accountingType: true,
      accountingMeta: true,
    },
  });

  const result = await provider.syncWorkEntries(entries, { metaKeys });
  if (!result.ok) {
    return Response.json({ ok: false, provider: provider.key, error: result.error }, { status: 500 });
  }

  return Response.json({ ok: true, provider: provider.key, result });
}
