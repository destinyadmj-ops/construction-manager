import { requireUserManager } from '@/server/auth/user-admin';
import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
};

export async function GET(request: Request) {
  const authError = await requireUserManager(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const userId = (url.searchParams.get('userId') ?? '').trim();
    if (!userId) {
      return Response.json({ ok: false, error: 'userId is required' }, { status: 400, headers: NO_STORE_HEADERS });
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
        },
      }),
      prisma.userNotification.count({ where: { userId, isRead: false } }),
    ]);

    return Response.json({ ok: true, notifications, unreadCount }, { headers: NO_STORE_HEADERS });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}