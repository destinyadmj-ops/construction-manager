import { getAccountingProvider } from '@/server/accounting';
import { ensureJdlExportDir, resolveJdlExportFilePath } from '@/server/accounting/jdlExport';
import { readFile } from 'node:fs/promises';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const provider = getAccountingProvider();
  if (provider.key !== 'jdl') {
    return Response.json(
      { ok: false, error: 'exports endpoint is only available for jdl provider' },
      { status: 400 },
    );
  }

  const { file } = await ctx.params;
  const exportDir = await ensureJdlExportDir();
  const filePath = resolveJdlExportFilePath(exportDir, file);

  // Basic allowlist
  if (!path.basename(file).toLowerCase().endsWith('.csv')) {
    return Response.json({ ok: false, error: 'only .csv is allowed' }, { status: 400 });
  }

  try {
    const buf = await readFile(filePath);
    return new Response(buf, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${path.basename(file)}"`,
      },
    });
  } catch {
    return Response.json({ ok: false, error: 'file not found' }, { status: 404 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const provider = getAccountingProvider();
  if (provider.key !== 'jdl') {
    return Response.json(
      { ok: false, error: 'exports endpoint is only available for jdl provider' },
      { status: 400 },
    );
  }

  const { file } = await ctx.params;
  const exportDir = await ensureJdlExportDir();
  const filePath = resolveJdlExportFilePath(exportDir, file);

  if (!path.basename(file).toLowerCase().endsWith('.csv')) {
    return Response.json({ ok: false, error: 'only .csv is allowed' }, { status: 400 });
  }

  try {
    await unlink(filePath);
    return Response.json({ ok: true, deleted: path.basename(file) });
  } catch {
    return Response.json({ ok: false, error: 'file not found' }, { status: 404 });
  }
}
