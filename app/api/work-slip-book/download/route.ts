import * as XLSX from 'xlsx';
import { snapshotToSheetJs } from '@/shared/work-slip-book-convert';
import { getCurrentMeta, readVersion } from '@/server/work-slip-book';
import { guardWorkSlipBook } from '@/server/work-slip-book-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await guardWorkSlipBook(request);
  if (guard.response) return guard.response;

  const meta = await getCurrentMeta();
  const snapshot = meta ? await readVersion(meta.version) : null;
  if (!meta || !snapshot) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });

  const buffer = XLSX.write(snapshotToSheetJs(snapshot), { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="work-slip-book-v${meta.version}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
