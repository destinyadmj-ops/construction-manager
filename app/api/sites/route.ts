import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const CreateSchema = z
  .object({
    companyName: z.string().optional().nullable(),
    name: z.string().min(1).max(200),
    depreciationThreshold: z.number().int().min(1).max(999).optional(),
  })
  .strict();

const UpdateSchema = z
  .object({
    id: z.string().min(1),
    companyName: z.string().optional().nullable(),
    name: z.string().min(1).max(200).optional(),
    depreciationThreshold: z.number().int().min(1).max(999).optional(),
  })
  .strict();

function isAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

export async function GET() {
  try {
    const sites = await prisma.site.findMany({
      orderBy: [{ companyName: 'asc' }, { name: 'asc' }],
      take: 1000,
      select: {
        id: true,
        companyName: true,
        name: true,
        repeatRule: true,
        createdAt: true,
        depreciationThreshold: true,
        updatedAt: true,
      },
    });

    return Response.json({ ok: true, sites });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}

// Minimal helper for creating sites without Prisma Studio.
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);

  const asUpdate = UpdateSchema.safeParse(json ?? {});
  if (asUpdate.success) {
    const companyName =
      typeof asUpdate.data.companyName === 'string'
        ? asUpdate.data.companyName.trim() || null
        : asUpdate.data.companyName;

    const data: { companyName?: string | null; name?: string; depreciationThreshold?: number } = {};
    if (asUpdate.data.companyName !== undefined) data.companyName = companyName ?? null;
    if (typeof asUpdate.data.name === 'string') data.name = asUpdate.data.name.trim();
    if (typeof asUpdate.data.depreciationThreshold === 'number') {
      data.depreciationThreshold = asUpdate.data.depreciationThreshold;
    }

    try {
      const updated = await prisma.site.update({
        where: { id: asUpdate.data.id },
        data,
        select: { id: true },
      });
      return Response.json({ ok: true, site: updated });
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

  const companyName = asCreate.data.companyName?.trim() || null;
  const name = asCreate.data.name.trim();
  try {
    const created = await prisma.site.create({
      data: {
        companyName,
        name,
        depreciationThreshold: asCreate.data.depreciationThreshold ?? 10,
      },
      select: { id: true },
    });

    return Response.json({ ok: true, site: created });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Create failed' },
      { status: 503 },
    );
  }
}
