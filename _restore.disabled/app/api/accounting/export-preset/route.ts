import { prisma } from '@/server/db/prisma';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma';

export const runtime = 'nodejs';

const UpsertBodySchema = z
  .object({
    key: z.string().min(1).max(100),
    name: z.string().max(200).optional().nullable(),
    body: z.unknown(),
  })
  .strict();

function isAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    // Dev-friendly default: allow if not configured.
    return process.env.NODE_ENV !== 'production';
  }
  const provided = request.headers.get('x-admin-token');
  return provided === token;
}

// Returns the default export preset stored in DB.
// If nothing is stored yet, returns an empty body (safe default).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = (url.searchParams.get('key') ?? 'default').trim() || 'default';

  const preset = await prisma.accountingExportPreset.findUnique({
    where: { key },
    select: { key: true, name: true, body: true, updatedAt: true },
  });

  return Response.json({
    ok: true,
    key,
    preset: preset
      ? {
          key: preset.key,
          name: preset.name,
          body: preset.body,
          updatedAt: preset.updatedAt,
        }
      : null,
    body: preset?.body ?? {},
  });
}

// Upsert an export preset.
// - In production: requires ADMIN_TOKEN + header `x-admin-token`.
// - In non-production: allowed if ADMIN_TOKEN is not set.
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = UpsertBodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const key = parsed.data.key.trim();
  const name = parsed.data.name?.trim() || null;

  const body = parsed.data.body as Prisma.InputJsonValue;

  const preset = await prisma.accountingExportPreset.upsert({
    where: { key },
    create: { key, name, body },
    update: { name, body },
    select: { id: true, key: true, name: true, updatedAt: true },
  });

  return Response.json({ ok: true, preset });
}
