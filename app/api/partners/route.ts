import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const CreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().max(320).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .strict();

const UpdateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(200).optional(),
    email: z.string().max(320).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    outlookToEmailDefault: z.string().max(320).optional().nullable(),
    outlookSubjectReportDefault: z.string().max(200).optional().nullable(),
    outlookSubjectInvoiceDefault: z.string().max(200).optional().nullable(),
  })
  .strict();

function isAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

export async function GET() {
  try {
    const partners = await prisma.partner.findMany({
      orderBy: [{ name: 'asc' }],
      take: 1000,
      select: {
        id: true,
        name: true,
        email: true,
        notes: true,
        outlookToEmailDefault: true,
        outlookSubjectReportDefault: true,
        outlookSubjectInvoiceDefault: true,
        updatedAt: true,
      },
    });
    return Response.json({ ok: true, partners });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);

  const asUpdate = UpdateSchema.safeParse(json ?? {});
  if (asUpdate.success) {
    try {
      const data: {
        name?: string;
        email?: string | null;
        notes?: string | null;
        outlookToEmailDefault?: string | null;
        outlookSubjectReportDefault?: string | null;
        outlookSubjectInvoiceDefault?: string | null;
      } = {};
      if (typeof asUpdate.data.name === 'string') data.name = asUpdate.data.name.trim();
      if (asUpdate.data.email !== undefined) {
        data.email = typeof asUpdate.data.email === 'string' ? asUpdate.data.email.trim() || null : null;
      }
      if (asUpdate.data.notes !== undefined) {
        data.notes = typeof asUpdate.data.notes === 'string' ? asUpdate.data.notes.trim() || null : null;
      }
      if (asUpdate.data.outlookToEmailDefault !== undefined) {
        data.outlookToEmailDefault =
          typeof asUpdate.data.outlookToEmailDefault === 'string'
            ? asUpdate.data.outlookToEmailDefault.trim() || null
            : null;
      }
      if (asUpdate.data.outlookSubjectReportDefault !== undefined) {
        data.outlookSubjectReportDefault =
          typeof asUpdate.data.outlookSubjectReportDefault === 'string'
            ? asUpdate.data.outlookSubjectReportDefault.trim() || null
            : null;
      }
      if (asUpdate.data.outlookSubjectInvoiceDefault !== undefined) {
        data.outlookSubjectInvoiceDefault =
          typeof asUpdate.data.outlookSubjectInvoiceDefault === 'string'
            ? asUpdate.data.outlookSubjectInvoiceDefault.trim() || null
            : null;
      }

      const updated = await prisma.partner.update({
        where: { id: asUpdate.data.id },
        data,
        select: { id: true },
      });

      return Response.json({ ok: true, partner: updated });
    } catch (e) {
      return Response.json(
        { ok: false, error: e instanceof Error ? e.message : 'Update failed' },
        { status: 503 },
      );
    }
  }

  const asCreate = CreateSchema.safeParse(json ?? {});
  if (!asCreate.success) {
    return Response.json(
      { ok: false, error: 'Invalid body', issues: asCreate.error.issues },
      { status: 400 },
    );
  }

  try {
    const created = await prisma.partner.create({
      data: {
        name: asCreate.data.name.trim(),
        email: typeof asCreate.data.email === 'string' ? asCreate.data.email.trim() || null : null,
        notes: asCreate.data.notes ? asCreate.data.notes.trim() : null,
      },
      select: { id: true, name: true, notes: true },
    });

    return Response.json({ ok: true, partner: created });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Create failed' },
      { status: 503 },
    );
  }
}
