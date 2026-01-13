import { prisma } from '@/server/db/prisma';
import { cookies } from 'next/headers';
import { z } from 'zod';

export const runtime = 'nodejs';

const COOKIE_NAME = 'masterHub.uid';

async function requireUser() {
  const jar = await cookies();
  const userId = (jar.get(COOKIE_NAME)?.value ?? '').trim();
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user ? userId : null;
}

const BodySchema = z
  .object({
    action: z.enum(['IN', 'OUT']),
    siteId: z.string().min(1).optional(),
    note: z.string().max(200).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const userId = await requireUser();
  if (!userId) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const now = new Date();

  if (parsed.data.action === 'IN') {
    const row = await prisma.timeClock.create({
      data: {
        userId,
        siteId: parsed.data.siteId ?? null,
        inAt: now,
        outAt: null,
        note: parsed.data.note?.trim() || null,
      },
      select: { id: true, inAt: true },
    });

    return Response.json({ ok: true, id: row.id, inAt: row.inAt.toISOString() });
  }

  // OUT
  const open = await prisma.timeClock.findFirst({
    where: {
      userId,
      outAt: null,
      ...(parsed.data.siteId ? { siteId: parsed.data.siteId } : {}),
    },
    orderBy: { inAt: 'desc' },
    select: { id: true },
  });

  if (!open) {
    return Response.json({ ok: false, error: 'Open stamp not found' }, { status: 404 });
  }

  const updated = await prisma.timeClock.update({
    where: { id: open.id },
    data: { outAt: now },
    select: { id: true, outAt: true },
  });

  return Response.json({ ok: true, id: updated.id, outAt: updated.outAt?.toISOString() ?? null });
}
