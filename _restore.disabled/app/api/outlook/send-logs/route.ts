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
    status: z.enum(['SENT', 'FAILED']).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .refine((n) => n === undefined || (Number.isFinite(n) && n > 0 && n <= 200), { message: 'invalid limit' }),
  })
  .strict();

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    siteId: url.searchParams.get('siteId') ?? undefined,
    partnerId: url.searchParams.get('partnerId') ?? undefined,
    kind: (url.searchParams.get('kind') ?? undefined) as 'REPORT' | 'INVOICE' | undefined,
    status: (url.searchParams.get('status') ?? undefined) as 'SENT' | 'FAILED' | undefined,
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
    if (parsed.data.status) where.status = parsed.data.status;

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

    const rows = await prisma.outlookSendLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        site: { select: { id: true, companyName: true, name: true } },
        partner: { select: { id: true, name: true, email: true } },
      },
    });

    const logs = rows.map((r) => {
      const siteLabel = `${r.site.companyName ? `${r.site.companyName} ` : ''}${r.site.name}`.trim();
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        kind: r.kind,
        status: r.status,
        toEmail: r.toEmail,
        subject: r.subject,
        error: r.error,
        site: { id: r.site.id, label: siteLabel },
        partner: { id: r.partner.id, name: r.partner.name, email: r.partner.email },
      };
    });

    return Response.json({ ok: true, logs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return Response.json({ ok: false, error: msg }, { status: 503 });
  }
}
