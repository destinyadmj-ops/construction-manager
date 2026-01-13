import { prisma } from '@/server/db/prisma';
import { cookies } from 'next/headers';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

export const runtime = 'nodejs';

const COOKIE_NAME = 'masterHub.uid';

async function requireUser() {
  const jar = await cookies();
  const userId = (jar.get(COOKIE_NAME)?.value ?? '').trim();
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user ? userId : null;
}

function safeDownloadName(name: string) {
  const base = name.trim() || 'file';
  return base.replace(/[\\/\r\n\t\0<>:"|?*]+/g, '_').slice(0, 180);
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requireUser();
  if (!userId) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const docId = (id ?? '').trim();
  if (!docId) return Response.json({ ok: false, error: 'Invalid id' }, { status: 400 });

  const doc = await prisma.storedDocument.findUnique({
    where: { id: docId },
    select: { id: true, fileName: true, mimeType: true, storedPath: true, kind: true },
  });

  if (!doc) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });

  const p = doc.storedPath;
  if (!p || typeof p !== 'string') return Response.json({ ok: false, error: 'Missing storedPath' }, { status: 404 });

  const fileName = safeDownloadName(doc.fileName || path.basename(p));

  try {
    const stream = createReadStream(p);
    const body = Readable.toWeb(stream) as ReadableStream;

    return new Response(body, {
      headers: {
        'content-type': doc.mimeType || 'application/octet-stream',
        'content-disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch {
    return Response.json({ ok: false, error: 'File unavailable' }, { status: 404 });
  }
}
