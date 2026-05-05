import { prisma } from '@/server/db/prisma';
import { cookies } from 'next/headers';

const AUTH_COOKIE = 'masterHub.uid';

export function isAdminTokenAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

export async function canManageUsersByCookie(): Promise<boolean> {
  try {
    const jar = await cookies();
    const uid = (jar.get(AUTH_COOKIE)?.value ?? '').trim();
    if (!uid) return false;
    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: { canGrantScheduleEdit: true },
    });
    return user?.canGrantScheduleEdit === true;
  } catch {
    return false;
  }
}

export async function requireUserManager(request: Request): Promise<Response | null> {
  const allow = isAdminTokenAuthorized(request) || (await canManageUsersByCookie());
  if (!allow) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}