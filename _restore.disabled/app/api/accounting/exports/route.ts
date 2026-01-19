import { getAccountingProvider } from '@/server/accounting';
import { ensureJdlExportDir, listJdlExportFiles } from '@/server/accounting/jdlExport';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const provider = getAccountingProvider();
  if (provider.key !== 'jdl') {
    return Response.json(
      { ok: false, error: 'exports endpoint is only available for jdl provider' },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam))) : 50;

  const exportDir = await ensureJdlExportDir();
  const files = await listJdlExportFiles(exportDir, Number.isFinite(limit) ? limit : 50);

  return Response.json({ ok: true, provider: provider.key, exportDir, files });
}
