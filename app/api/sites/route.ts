import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const CreateSchema = z
  .object({
    companyName: z.string().optional().nullable(),
    name: z.string().min(1).max(200),
    address: z.string().max(500).optional().nullable(),
    pace: z.string().max(200).optional().nullable(),
    amount: z.union([z.string(), z.number()]).optional().nullable(),
    detail: z.string().max(5000).optional().nullable(),
    peopleCount: z.number().int().min(0).max(999999).optional().nullable(),
    caution: z.string().max(5000).optional().nullable(),
    depreciationThreshold: z.number().int().min(1).max(999).optional(),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
  })
  .strict();

const UpdateSchema = z
  .object({
    id: z.string().min(1),
    companyName: z.string().optional().nullable(),
    name: z.string().min(1).max(200).optional(),
    address: z.string().max(500).optional().nullable(),
    pace: z.string().max(200).optional().nullable(),
    amount: z.union([z.string(), z.number()]).optional().nullable(),
    detail: z.string().max(5000).optional().nullable(),
    peopleCount: z.number().int().min(0).max(999999).optional().nullable(),
    caution: z.string().max(5000).optional().nullable(),
    depreciationThreshold: z.number().int().min(1).max(999).optional(),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
  })
  .strict();

function isAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const kindParam = (url.searchParams.get('kind') ?? '').trim().toLowerCase();
    const kind = kindParam === 'daily' ? 'DAILY' : kindParam === 'normal' ? 'NORMAL' : null;

    const sites = await prisma.site.findMany({
      where: kind ? { kind } : undefined,
      orderBy: [{ companyName: 'asc' }, { name: 'asc' }],
      take: 1000,
      select: {
        id: true,
        companyName: true,
        name: true,
        kind: true,
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

    const address =
      typeof asUpdate.data.address === 'string' ? asUpdate.data.address.trim() || null : asUpdate.data.address;
    const pace = typeof asUpdate.data.pace === 'string' ? asUpdate.data.pace.trim() || null : asUpdate.data.pace;
    const amount =
      typeof asUpdate.data.amount === 'string'
        ? asUpdate.data.amount.trim() || null
        : typeof asUpdate.data.amount === 'number'
          ? asUpdate.data.amount
          : asUpdate.data.amount;
    const detail =
      typeof asUpdate.data.detail === 'string' ? asUpdate.data.detail.trim() || null : asUpdate.data.detail;
    const caution =
      typeof asUpdate.data.caution === 'string' ? asUpdate.data.caution.trim() || null : asUpdate.data.caution;

    const data: {
      companyName?: string | null;
      name?: string;
      address?: string | null;
      pace?: string | null;
      amount?: string | number | null;
      detail?: string | null;
      peopleCount?: number | null;
      caution?: string | null;
      depreciationThreshold?: number;
      kind?: 'NORMAL' | 'DAILY';
    } = {};
    if (asUpdate.data.companyName !== undefined) data.companyName = companyName ?? null;
    if (typeof asUpdate.data.name === 'string') data.name = asUpdate.data.name.trim();
    if (asUpdate.data.address !== undefined) data.address = address ?? null;
    if (asUpdate.data.pace !== undefined) data.pace = pace ?? null;
    if (asUpdate.data.amount !== undefined) data.amount = (amount as string | number | null) ?? null;
    if (asUpdate.data.detail !== undefined) data.detail = detail ?? null;
    if (asUpdate.data.peopleCount !== undefined) data.peopleCount = asUpdate.data.peopleCount ?? null;
    if (asUpdate.data.caution !== undefined) data.caution = caution ?? null;
    if (typeof asUpdate.data.depreciationThreshold === 'number') {
      data.depreciationThreshold = asUpdate.data.depreciationThreshold;
    }
    if (asUpdate.data.kind) data.kind = asUpdate.data.kind;

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
  const address = asCreate.data.address?.trim() || null;
  const pace = asCreate.data.pace?.trim() || null;
  const amount =
    typeof asCreate.data.amount === 'string'
      ? asCreate.data.amount.trim() || null
      : typeof asCreate.data.amount === 'number'
        ? asCreate.data.amount
        : null;
  const detail = asCreate.data.detail?.trim() || null;
  const peopleCount = typeof asCreate.data.peopleCount === 'number' ? asCreate.data.peopleCount : null;
  const caution = asCreate.data.caution?.trim() || null;
  try {
    const created = await prisma.site.create({
      data: {
        companyName,
        name,
        address,
        pace,
        amount: (amount as string | number | null) ?? null,
        detail,
        peopleCount,
        caution,
        depreciationThreshold: asCreate.data.depreciationThreshold ?? 10,
        kind: asCreate.data.kind ?? 'NORMAL',
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
