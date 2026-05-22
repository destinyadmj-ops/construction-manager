import { prisma } from '@/server/db/prisma';
import { canCurrentUserEditSchedule, isMobileRequest } from '@/server/auth/schedule-edit';
import { ensureSiteDayFolders } from '@/server/site-storage';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

const COOKIE_NAME = 'masterHub.uid';

const EXCEL_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroenabled.12',
]);

const EXCEL_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm']);

function safeFileName(name: string) {
  const base = name.trim() || 'work-slip';
  return base.replace(/[\\/\r\n\t\0<>:"|?*]+/g, '_').slice(0, 140);
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

function isExcelFile(file: File, fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (EXCEL_EXTENSIONS.has(extension)) return true;
  const mimeType = (file.type || '').trim().toLowerCase();
  return EXCEL_MIME_TYPES.has(mimeType);
}

async function requireUser() {
  const jar = await cookies();
  const userId = (jar.get(COOKIE_NAME)?.value ?? '').trim();
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user ? userId : null;
}

const QuerySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    subject: z.string().trim().max(200).optional(),
  })
  .partial();

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requireUser();
  if (!userId) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const siteId = (id ?? '').trim();
  if (!siteId) return Response.json({ ok: false, error: 'Invalid siteId' }, { status: 400 });

  const url = new URL(request.url);
  const dateYmd = (url.searchParams.get('date') ?? '').trim();
  const dateFilter = /^\d{4}-\d{2}-\d{2}$/.test(dateYmd) ? dateYmd : null;

  const rows = await prisma.storedDocument.findMany({
    where: { siteId, kind: 'WORK_SLIP', ...(dateFilter ? { bizDateYmd: dateFilter } : {}) },
    orderBy: [{ bizDateYmd: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: { id: true, createdAt: true, fileName: true, mimeType: true, sizeBytes: true, bizDateYmd: true, subject: true },
  });

  return Response.json({
    ok: true,
    workSlips: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      bizDateYmd: row.bizDateYmd,
      subject: row.subject,
    })),
  });
}

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
  const parsedQuery = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const dateFromFormRaw = form.get('date');
  const dateFromForm = typeof dateFromFormRaw === 'string' ? dateFromFormRaw.trim() : '';
  const queryDate = parsedQuery.success ? (parsedQuery.data.date ?? '').trim() : '';
  const dateYmd = /^\d{4}-\d{2}-\d{2}$/.test(dateFromForm)
    ? dateFromForm
    : /^\d{4}-\d{2}-\d{2}$/.test(queryDate)
      ? queryDate
      : ymdInTokyo(new Date());

  const subjectFromForm = form.get('subject');
  const subject = typeof subjectFromForm === 'string'
    ? subjectFromForm.trim().slice(0, 200)
    : parsedQuery.success
      ? (parsedQuery.data.subject ?? null)
      : null;

  const files = form.getAll('files');
  const uploadFiles = files.filter((value): value is File => typeof File !== 'undefined' && value instanceof File);
  if (uploadFiles.length === 0) return Response.json({ ok: false, error: 'No files' }, { status: 400 });

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { id: true, name: true } });
  if (!site) return Response.json({ ok: false, error: 'Site not found' }, { status: 404 });

  const { workSlipsDir } = await ensureSiteDayFolders({ siteId, siteName: site.name, dayYmd: dateYmd });
  const createdIds: string[] = [];

  for (const file of uploadFiles.slice(0, 20)) {
    const originalName = safeFileName(file.name || 'work-slip');
    if (!isExcelFile(file, originalName)) {
      return Response.json({ ok: false, error: 'Excel ファイルのみアップロードできます' }, { status: 400 });
    }

    const extension = path.extname(originalName);
    const stem = path.basename(originalName, extension);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(16).slice(2, 10);
    const storedName = `${timestamp}__${random}__${stem}${extension || ''}`;
    const storedPath = path.join(workSlipsDir, storedName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(storedPath, buffer);

    const row = await prisma.storedDocument.create({
      data: {
        siteId,
        kind: 'WORK_SLIP',
        subject: subject || null,
        bizDateYmd: dateYmd,
        tags: { uploadedBy: userId },
        fileName: file.name || originalName,
        mimeType: (file.type || 'application/octet-stream').slice(0, 200),
        sizeBytes: buffer.length,
        storedPath,
      },
      select: { id: true },
    });

    createdIds.push(row.id);
  }

  return Response.json({ ok: true, created: createdIds.length, ids: createdIds });
}