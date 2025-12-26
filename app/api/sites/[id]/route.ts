import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';

function isAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });
  }

  try {
    await prisma.site.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Delete failed' },
      { status: 503 },
    );
  }
}
