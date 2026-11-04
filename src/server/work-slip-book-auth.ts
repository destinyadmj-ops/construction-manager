import { cookies } from 'next/headers';
import { isMobileRequest, requireScheduleEditor } from '@/server/auth/schedule-edit';
import { prisma } from '@/server/db/prisma';

type Guard = { response: Response } | { response: null; user: { id: string | null; name: string | null } };

// 編集権限保持者(PC)のみ。モバイルは常に拒否する。
export async function guardWorkSlipBook(request: Request): Promise<Guard> {
  if (isMobileRequest(request)) {
    return { response: Response.json({ ok: false, error: 'Edit permission required' }, { status: 403 }) };
  }
  const denied = await requireScheduleEditor(request);
  if (denied) return { response: denied };

  const jar = await cookies();
  const id = (jar.get('masterHub.uid')?.value ?? '').trim() || null;
  const row = id ? await prisma.user.findUnique({ where: { id }, select: { name: true, email: true } }) : null;
  return { response: null, user: { id, name: row?.name ?? row?.email ?? null } };
}
