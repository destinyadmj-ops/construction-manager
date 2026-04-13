import { prisma } from '@/server/db/prisma';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'masterHub.uid';

function isAdminRequest(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

export async function requireScheduleEditor(request: Request): Promise<Response | null> {
  if (isAdminRequest(request)) return null;

  const jar = await cookies();
  const userId = (jar.get(COOKIE_NAME)?.value ?? '').trim();
  if (!userId) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, canEditSchedule: true, canGrantScheduleEdit: true },
  });

  if (!user) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (!user.canEditSchedule && !user.canGrantScheduleEdit) {
    return Response.json({ ok: false, error: 'Edit permission required' }, { status: 403 });
  }

  return null;
}