import { prisma } from '@/server/db/prisma';
import { cookies } from 'next/headers';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

const COOKIE_NAME = 'masterHub.uid';

async function requireUser() {
  const jar = await cookies();
  const userId = (jar.get(COOKIE_NAME)?.value ?? '').trim();
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user ? userId : null;
}

function safePathSegment(name: string) {
  const base = name.trim() || 'untitled';
  return base
    .replace(/[\\/\r\n\t\0<>:"|?*]+/g, '_')
    .replace(/[\s.]+$/g, '')
    .slice(0, 80);
}

function ymdInTokyo(d: Date) {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requireUser();
  if (!userId) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const siteId = (id ?? '').trim();
  if (!siteId) return Response.json({ ok: false, error: 'Invalid siteId' }, { status: 400 });

  const url = new URL(request.url);
  const dateYmdRaw = (url.searchParams.get('date') ?? '').trim();
  const dateYmd = /^\d{4}-\d{2}-\d{2}$/.test(dateYmdRaw) ? dateYmdRaw : ymdInTokyo(new Date());

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { id: true, name: true } });
  if (!site) return Response.json({ ok: false, error: 'Site not found' }, { status: 404 });

  const baseDir = process.env.MASTER_HUB_STORAGE_DIR
    ? path.resolve(process.env.MASTER_HUB_STORAGE_DIR)
    : path.join(process.cwd(), '.storage');

  const siteFolderBase = safePathSegment(site.name) || siteId;
  const siteFolder = `${siteFolderBase}__${siteId.slice(0, 8)}`;

  const folderRoot = path.join(baseDir, 'sites', siteFolder, dateYmd);
  const photosDir = path.join(folderRoot, 'photos');
  const reportsDir = path.join(folderRoot, 'reports');

  await mkdir(photosDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });

  const docs = await prisma.storedDocument.findMany({
    where: {
      siteId,
      bizDateYmd: dateYmd,
      kind: { in: ['PHOTO', 'REPORT'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, kind: true, createdAt: true, fileName: true, mimeType: true, sizeBytes: true },
  });

  const photos = docs
    .filter((d) => d.kind === 'PHOTO')
    .map((d) => ({
      id: d.id,
      createdAt: d.createdAt.toISOString(),
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
    }));

  const reports = docs
    .filter((d) => d.kind === 'REPORT')
    .map((d) => ({
      id: d.id,
      createdAt: d.createdAt.toISOString(),
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
    }));

  return Response.json({
    ok: true,
    siteId,
    dateYmd,
    folder: {
      siteFolder,
      folderRoot,
      photosDir,
      reportsDir,
    },
    photos,
    reports,
  });
}
