import { prisma } from '@/server/db/prisma';
import { cookies } from 'next/headers';
import { z } from 'zod';

export const runtime = 'nodejs';

const COOKIE_NAME = 'masterHub.uid';

const PatchSchema = z
  .object({
    ids: z.array(z.string().min(1).max(200)).max(100).optional(),
    markAllRead: z.boolean().optional(),
  })
  .strict();

async function getCurrentUserId() {
  const jar = await cookies();
  return (jar.get(COOKIE_NAME)?.value ?? '').trim();
}

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const [notifications, unreadCount] = await Promise.all([
      prisma.userNotification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          kind: true,
          title: true,
          body: true,
          isRead: true,
          readAt: true,
          createdAt: true,
          metadata: true,
        },
      }),
      prisma.userNotification.count({ where: { userId, isRead: false } }),
    ]);

    return Response.json({ ok: true, notifications, unreadCount });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const ids = parsed.data.ids?.map((id) => id.trim()).filter(Boolean) ?? [];
    if (!parsed.data.markAllRead && ids.length === 0) {
      return Response.json({ ok: false, error: 'ids or markAllRead is required' }, { status: 400 });
    }

    const where = parsed.data.markAllRead ? { userId, isRead: false } : { userId, id: { in: ids } };
    const now = new Date();

    await prisma.userNotification.updateMany({
      where,
      data: {
        isRead: true,
        readAt: now,
      },
    });

    const unreadCount = await prisma.userNotification.count({ where: { userId, isRead: false } });
    return Response.json({ ok: true, unreadCount });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}