import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const BodySchema = z
  .object({
    siteIds: z.array(z.string().min(1)).min(1),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

function isAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function safeFilePart(input: string) {
  const v = input.trim();
  if (!v) return 'unknown';
  return v
    .replace(/[\\/]/g, '-')
    .replace(/[:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const fromStr = parsed.data.from;
  const toStr = parsed.data.to;
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return Response.json({ ok: false, error: 'Invalid from/to' }, { status: 400 });
  }
  if (from.getTime() > to.getTime()) {
    return Response.json({ ok: false, error: 'from must be <= to' }, { status: 400 });
  }

  const month = fromStr.slice(0, 7);
  const monthBase = new Date(`${month}-01T00:00:00`);
  const monthSince = startOfDay(new Date(monthBase.getFullYear(), monthBase.getMonth(), 1));
  const monthUntil = startOfDay(new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 1));

  const createdAt = startOfDay(new Date(monthBase.getFullYear(), monthBase.getMonth(), Math.min(28, from.getDate() || 1)));

  try {
    const uniqueSiteIds = Array.from(new Set(parsed.data.siteIds.map((x) => x.trim()).filter((x) => x.length > 0))).slice(
      0,
      300,
    );

    const sites = await prisma.site.findMany({
      where: { id: { in: uniqueSiteIds } },
      select: { id: true, name: true, companyName: true },
    });

    const foundSet = new Set(sites.map((s) => s.id));
    const missingSiteIds = uniqueSiteIds.filter((id) => !foundSet.has(id));

    const existing = await prisma.storedDocument.findMany({
      where: { siteId: { in: uniqueSiteIds }, kind: 'INVOICE', createdAt: { gte: monthSince, lt: monthUntil } },
      select: { id: true, siteId: true },
    });
    const existingSet = new Set(existing.map((d) => d.siteId).filter((x): x is string => !!x));

    const toCreate = sites.filter((s) => !existingSet.has(s.id));

    if (toCreate.length > 0) {
      await prisma.storedDocument.createMany({
        data: toCreate.map((s) => {
          const siteLabel = `${s.companyName ? `${s.companyName} / ` : ''}${s.name}`.trim();
          const fileName = `invoice_${month}_${safeFilePart(siteLabel)}.pdf`;
          return {
            siteId: s.id,
            partnerId: null,
            kind: 'INVOICE',
            subject: `請求書 ${fromStr}〜${toStr}`,
            tags: { action: 'ISSUE', from: fromStr, to: toStr, month },
            fileName,
            mimeType: 'application/pdf',
            sizeBytes: 0,
            storedPath: `issued://invoice/${s.id}/${fromStr}_${toStr}`,
            createdAt,
            updatedAt: createdAt,
          };
        }),
      });
    }

    return Response.json({
      ok: true,
      month,
      createdAt: createdAt.toISOString(),
      requested: uniqueSiteIds.length,
      created: toCreate.length,
      alreadyIssued: sites.length - toCreate.length,
      missingSiteIds,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}
