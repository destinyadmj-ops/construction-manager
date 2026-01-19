import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

function isAuthorized(request: Request): boolean {
  const sendToken = process.env.OUTLOOK_SEND_TOKEN;
  if (sendToken) return request.headers.get('x-outlook-send-token') === sendToken;

  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken) return request.headers.get('x-admin-token') === adminToken;

  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.ALLOW_EMAIL_SEND_IN_PROD === '1';
}

const QuerySchema = z
  .object({
    siteId: z.string().optional(),
    partnerId: z.string().optional(),
    kind: z.enum(['REPORT', 'INVOICE']).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .refine((n) => n === undefined || (Number.isFinite(n) && n > 0 && n <= 200), { message: 'invalid limit' }),
  })
  .strict();

function getActionFromTags(tags: unknown): string | null {
  if (!tags || typeof tags !== 'object') return null;
  const v = (tags as Record<string, unknown>).action;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function inferAction(args: { tags: unknown; storedPath: string }): string {
  const fromTags = getActionFromTags(args.tags);
  if (fromTags) return fromTags;
  if (args.storedPath.startsWith('issued://')) return 'ISSUE';
  if (args.storedPath.includes('__PRINT')) return 'PRINT';
  return 'STORE';
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    siteId: url.searchParams.get('siteId') ?? undefined,
    partnerId: url.searchParams.get('partnerId') ?? undefined,
    kind: (url.searchParams.get('kind') ?? undefined) as 'REPORT' | 'INVOICE' | undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid query', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const limit = parsed.data.limit ?? 50;
    const where: Record<string, unknown> = {};
    if (parsed.data.siteId) where.siteId = parsed.data.siteId;
    if (parsed.data.partnerId) where.partnerId = parsed.data.partnerId;
    if (parsed.data.kind) where.kind = parsed.data.kind;

    const fromDate = parsed.data.from ? new Date(parsed.data.from) : null;
    const toDate = parsed.data.to ? new Date(parsed.data.to) : null;
    if (fromDate && Number.isNaN(fromDate.getTime())) {
      return Response.json({ ok: false, error: 'Invalid from' }, { status: 400 });
    }
    if (toDate && Number.isNaN(toDate.getTime())) {
      return Response.json({ ok: false, error: 'Invalid to' }, { status: 400 });
    }
    if (fromDate || toDate) {
      where.createdAt = {
        ...(fromDate ? { gte: fromDate } : null),
        ...(toDate ? { lt: toDate } : null),
      };
    }

    const rows = await prisma.storedDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        site: { select: { id: true, companyName: true, name: true } },
        partner: { select: { id: true, name: true, email: true } },
      },
    });

    const documents = rows.map((r) => {
      const siteLabel = r.site ? `${r.site.companyName ? `${r.site.companyName} ` : ''}${r.site.name}`.trim() : null;
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        kind: r.kind,
        action: inferAction({ tags: r.tags, storedPath: r.storedPath }),
        subject: r.subject,
        fileName: r.fileName,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        storedPath: r.storedPath,
        tags: r.tags,
        site: r.site ? { id: r.site.id, label: siteLabel ?? r.site.id } : null,
        partner: r.partner ? { id: r.partner.id, name: r.partner.name, email: r.partner.email } : null,
      };
    });

    return Response.json({ ok: true, documents });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return Response.json({ ok: false, error: msg }, { status: 503 });
  }
}
