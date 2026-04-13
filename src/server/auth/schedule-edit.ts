import { prisma } from '@/server/db/prisma';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'masterHub.uid';

export function isMobileRequest(request: Request): boolean {
  const userAgent = (request.headers.get('user-agent') ?? '').toLowerCase();
  return /android|iphone|ipad|ipod|mobile/.test(userAgent);
}

function isAdminRequest(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

export async function canCurrentUserEditSchedule(request?: Request): Promise<boolean> {
  if (request && isAdminRequest(request)) return true;

  const jar = await cookies();
  const userId = (jar.get(COOKIE_NAME)?.value ?? '').trim();
  if (!userId) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, canEditSchedule: true, canGrantScheduleEdit: true },
  });

  return !!user && (user.canEditSchedule || user.canGrantScheduleEdit);
}

export async function requireScheduleEditor(request: Request): Promise<Response | null> {
  const canEdit = await canCurrentUserEditSchedule(request);
  if (!canEdit) {
    const jar = await cookies();
    const userId = (jar.get(COOKIE_NAME)?.value ?? '').trim();
    if (!userId) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return Response.json({ ok: false, error: 'Edit permission required' }, { status: 403 });
  }

  return null;
}