import { prisma } from '@/server/db/prisma';
import { canCurrentUserEditSchedule, isMobileRequest } from '@/server/auth/schedule-edit';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

const COOKIE_NAME = 'masterHub.uid';

function safeFileName(name: string) {
  const base = name.trim() || 'photo';
  return base.replace(/[\\/\r\n\t\0<>:"|?*]+/g, '_').slice(0, 140);
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

async function requireUser() {
  const jar = await cookies();
  const userId = (jar.get(COOKIE_NAME)?.value ?? '').trim();
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user ? userId : null;
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requireUser();
  if (!userId) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const siteId = (id ?? '').trim();
  if (!siteId) return Response.json({ ok: false, error: 'Invalid siteId' }, { status: 400 });

  const url = new URL(_request.url);
  const dateYmd = (url.searchParams.get('date') ?? '').trim();
  const dateFilter = /^\d{4}-\d{2}-\d{2}$/.test(dateYmd) ? dateYmd : null;

  const rows = await prisma.storedDocument.findMany({
    where: { siteId, kind: 'PHOTO', ...(dateFilter ? { bizDateYmd: dateFilter } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, createdAt: true, fileName: true, mimeType: true, sizeBytes: true, bizDateYmd: true },
  });

  return Response.json({
    ok: true,
    photos: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      fileName: r.fileName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      bizDateYmd: r.bizDateYmd,
    })),
  });
}

const UploadQuerySchema = z
  .object({
    // optional tags (comma separated)
    tags: z.string().max(400).optional(),
    // optional date key (YYYY-MM-DD)
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .partial();

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const canUpload = isMobileRequest(request) || (await canCurrentUserEditSchedule(request));
  if (!canUpload) {
    return Response.json({ ok: false, error: 'Edit permission required' }, { status: 403 });
  }

  const userId = await requireUser();
  if (!userId) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const siteId = (id ?? '').trim();
  if (!siteId) return Response.json({ ok: false, error: 'Invalid siteId' }, { status: 400 });

  const url = new URL(request.url);
  const parsedQuery = UploadQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  const tagText = parsedQuery.success ? (parsedQuery.data.tags ?? '').trim() : '';
  const dateFromQuery = parsedQuery.success ? (parsedQuery.data.date ?? '').trim() : '';
  const tagList = tagText
    ? tagText
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 20)
    : [];

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const dateFromFormRaw = form.get('date');
  const dateFromForm = typeof dateFromFormRaw === 'string' ? dateFromFormRaw.trim() : '';
  const dateYmd = (/^\d{4}-\d{2}-\d{2}$/.test(dateFromForm)
    ? dateFromForm
    : /^\d{4}-\d{2}-\d{2}$/.test(dateFromQuery)
      ? dateFromQuery
      : ymdInTokyo(new Date()));

  const files = form.getAll('files');
  const uploadFiles = files.filter((f): f is File => typeof File !== 'undefined' && f instanceof File);
  if (uploadFiles.length === 0) return Response.json({ ok: false, error: 'No files' }, { status: 400 });

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { name: true } });
  if (!site) return Response.json({ ok: false, error: 'Site not found' }, { status: 404 });

  const baseDir = process.env.MASTER_HUB_STORAGE_DIR
    ? path.resolve(process.env.MASTER_HUB_STORAGE_DIR)
    : path.join(process.cwd(), '.storage');
  const siteFolderBase = safePathSegment(site.name) || siteId;
  const siteFolder = `${siteFolderBase}__${siteId.slice(0, 8)}`;
  const outDir = path.join(baseDir, 'sites', siteFolder, dateYmd, 'photos');
  await mkdir(outDir, { recursive: true });

  const createdIds: string[] = [];

  for (const f of uploadFiles.slice(0, 30)) {
    const origName = safeFileName(f.name || 'photo');
    const ext = path.extname(origName);
    const stem = path.basename(origName, ext);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const rand = Math.random().toString(16).slice(2, 10);
    const storedName = `${ts}__${rand}__${stem}${ext || ''}`;
    const storedPath = path.join(outDir, storedName);

    const buf = Buffer.from(await f.arrayBuffer());
    await writeFile(storedPath, buf);

    const mimeType = (f.type || 'application/octet-stream').slice(0, 200);
    const sizeBytes = buf.length;

    const row = await prisma.storedDocument.create({
      data: {
        siteId,
        kind: 'PHOTO',
        subject: null,
        bizDateYmd: dateYmd,
        tags: tagList.length ? { uploadedBy: userId, tags: tagList } : { uploadedBy: userId },
        fileName: f.name || origName,
        mimeType,
        sizeBytes,
        storedPath,
      },
      select: { id: true },
    });

    createdIds.push(row.id);
  }

  return Response.json({ ok: true, created: createdIds.length, ids: createdIds });
}
